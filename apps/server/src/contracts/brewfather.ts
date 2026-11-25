// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "@hono/zod-openapi";
import { CreateBatch, ReadingInput } from "./batches.ts";
import { CreateInventoryItem } from "./inventory.ts";
import { RecipeFile } from "./recipe-file.ts";
import { CreditInput } from "./recipes.ts";

export const BrewfatherCredentials = z
  .strictObject({
    userId: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[!-9;-~]+$/),
    apiKey: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[!-~]+$/),
  })
  .openapi("BrewfatherCredentials");

const ref = z.string().min(1).max(260);
const date = z.iso.datetime();
const BrewfatherRecipeDraft = z
  .strictObject({
    ...RecipeFile.shape,
    visibility: z.literal("private"),
    credit: CreditInput.optional(),
  })
  .openapi("BrewfatherRecipeDraft");

export const BrewfatherImport = z
  .strictObject({
    recipes: z.array(z.strictObject({ ref, draft: BrewfatherRecipeDraft })).max(500),
    batches: z
      .array(
        z.strictObject({
          recipeRef: ref,
          name: CreateBatch.shape.name,
          batchSizeL: CreateBatch.shape.batchSizeL,
          status: z.enum([
            "planned",
            "brewing",
            "fermenting",
            "conditioning",
            "packaged",
            "finished",
          ]),
          brewedAt: date.optional(),
          completedAt: date.optional(),
          readings: z.array(ReadingInput).max(20_000),
        }),
      )
      .max(250),
    inventory: z.array(CreateInventoryItem.omit({ breweryId: true })).max(1_000),
  })
  .openapi("BrewfatherImport");

export type BrewfatherImport = z.infer<typeof BrewfatherImport>;
