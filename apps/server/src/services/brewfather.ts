// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Db } from "@brew-bruvs/db";
import { ZodError, type z } from "zod";
import { type BrewfatherCredentials, BrewfatherImport } from "../contracts/brewfather.ts";
import { ApiError } from "../errors.ts";
import {
  brewfatherBatch,
  brewfatherDraft,
  brewfatherId,
  brewfatherStock,
  inventoryKinds,
} from "../importers/brewfather.ts";
import { type BrewfatherFetch, brewfatherClient } from "../integrations/brewfather.ts";
import type { User } from "../permissions.ts";
import { signedIn } from "./access.ts";
import type { BatchService } from "./batches.ts";
import type { InventoryService } from "./inventory.ts";
import { loadIngredientMatcher } from "./recipe-files.ts";
import type { RecipeService } from "./recipes.ts";

const agedStatus = {
  planned: "planned",
  brewing: "primary",
  fermenting: "primary",
  conditioning: "bulk_aging",
  packaged: "bottled",
  finished: "finished",
} as const;

export function createBrewfatherService(db: Db, fetcher: BrewfatherFetch = fetch) {
  return {
    async preview(viewer: User | null, input: z.infer<typeof BrewfatherCredentials>) {
      signedIn(viewer);
      const client = brewfatherClient(input, fetcher);
      try {
        const recipes = new Map<string, BrewfatherImport["recipes"][number]["draft"]>();
        const batches: BrewfatherImport["batches"] = [];
        const inventory: BrewfatherImport["inventory"] = [];
        const rows = await client.list("recipes", 250);
        for (const row of rows)
          recipes.set(`recipe:${brewfatherId(row._id)}`, brewfatherDraft(row));

        for (const row of await client.list("batches", 250)) {
          const id = brewfatherId(row._id);
          if (!row.recipe || typeof row.recipe !== "object" || Array.isArray(row.recipe)) {
            throw new ApiError(422, "brewfather_data_invalid", "A Brewfather batch has no recipe");
          }
          const raw = row.recipe as Record<string, unknown>;
          const snapshot = brewfatherDraft(raw);
          const recipeRef = typeof raw._id === "string" ? `recipe:${raw._id}` : "";
          // A batch may have scaled or edited its recipe since brew day. Keep its snapshot.
          const ref =
            JSON.stringify(recipes.get(recipeRef)) === JSON.stringify(snapshot)
              ? recipeRef
              : `batch:${id}`;
          recipes.set(ref, snapshot);
          const readings = await client.readings(id);
          if (readings.length > 20_000) {
            throw new ApiError(
              413,
              "brewfather_import_too_large",
              "A Brewfather batch has too many readings",
            );
          }
          batches.push(brewfatherBatch(row, ref, readings));
        }

        const [fermentables, hops, yeasts, miscs] = await Promise.all([
          loadIngredientMatcher(db, "fermentables"),
          loadIngredientMatcher(db, "hops"),
          loadIngredientMatcher(db, "yeasts"),
          loadIngredientMatcher(db, "miscs"),
        ]);
        const matchers = { fermentables, hops, yeasts, miscs };
        for (const kind of inventoryKinds) {
          const match = matchers[kind];
          for (const row of await client.list(`inventory/${kind}`, 250)) {
            inventory.push(...brewfatherStock(row, kind).map((item) => match(item)));
          }
          for (const draft of recipes.values()) {
            for (const line of draft.content[kind]) Object.assign(line, match(line));
          }
        }

        return BrewfatherImport.parse({
          recipes: Array.from(recipes, ([ref, draft]) => ({ ref, draft })),
          batches,
          inventory,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ApiError(
            422,
            "brewfather_data_invalid",
            "Brewfather returned data that could not be imported",
          );
        }
        throw error;
      }
    },

    async save(
      viewer: User | null,
      data: BrewfatherImport,
      services: { recipes: RecipeService; batches: BatchService; inventory: InventoryService },
    ) {
      const user = signedIn(viewer);
      const refs = new Set(data.recipes.map(({ ref }) => ref));
      if (refs.size !== data.recipes.length || data.batches.some((b) => !refs.has(b.recipeRef))) {
        throw new ApiError(
          400,
          "invalid_import",
          "Every batch must reference a recipe draft included once",
        );
      }

      return db.transaction(async (tx) => {
        const recipeIds = new Map<string, { id: string; beverage: string }>();
        const batchIds: string[] = [];
        const inventoryIds: string[] = [];
        for (const { ref, draft } of data.recipes) {
          const recipe = await services.recipes.create(user, draft, tx);
          recipeIds.set(ref, { id: recipe.id, beverage: recipe.beverage });
        }
        for (const batch of data.batches) {
          const recipe = recipeIds.get(batch.recipeRef);
          if (!recipe) throw new Error("Imported recipe is missing");
          const { id } = await services.batches.create(
            user,
            { recipeId: recipe.id, name: batch.name, batchSizeL: batch.batchSizeL },
            {
              tx,
              history: {
                status: recipe.beverage === "beer" ? batch.status : agedStatus[batch.status],
                brewedAt: batch.brewedAt ? new Date(batch.brewedAt) : null,
                completedAt: batch.completedAt ? new Date(batch.completedAt) : null,
                readings: batch.readings,
              },
            },
          );
          batchIds.push(id);
        }
        for (const item of data.inventory) {
          inventoryIds.push((await services.inventory.create(user, item, tx)).id);
        }
        return {
          recipeIds: Array.from(recipeIds.values(), ({ id }) => id),
          batchIds,
          inventoryIds,
        };
      });
    },
  };
}

export type BrewfatherService = ReturnType<typeof createBrewfatherService>;
