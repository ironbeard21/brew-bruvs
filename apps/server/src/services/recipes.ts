// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipes: create, list and search, immutable versions with stats, visibility, shares, forks,
// and scaling to an equipment profile. Every access goes through can().
import { styleFit } from "@brew-bruvs/brew-math";
import { type Db, schema } from "@brew-bruvs/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { RecipeContent } from "../contracts/recipe-content.ts";
import type {
  CreateRecipe,
  ForkInput,
  RecipePatch,
  RecipeVersionInput,
  ScaleInput,
  ShareInput,
} from "../contracts/recipes.ts";
import { ApiError, pgCode } from "../errors.ts";
import type { Action, User } from "../permissions.ts";
import { authorizeRow, newId, newOwner, ownerOf, readableBy, signedIn, type Tx } from "./access.ts";
import type { EquipmentProfileService } from "./equipment-profiles.ts";
import {
  catalogValues,
  computeStats,
  efficiencyOf,
  equipmentOf,
  scaleContent,
  versionStats,
} from "./recipe-stats.ts";

const { recipes, recipeVersions, shares, styles, users, breweries } = schema;

type RecipeRow = typeof recipes.$inferSelect;
type VersionRow = typeof recipeVersions.$inferSelect;

// Written out in full: drizzle leaves single-table columns unqualified, which would bind "id"
// to recipe_versions inside the subquery.
const latestVersion = sql<number>`(SELECT max(v.version) FROM recipe_versions v WHERE v.recipe_id = "recipes"."id")`;

const iso = (d: Date | null) => d?.toISOString() ?? null;

function viewRecipe(row: RecipeRow & { latestVersion: number }) {
  const imported = row.creditSourceUrl !== null || row.creditImportedAt !== null;
  const owner = ownerOf(row);
  return {
    id: row.id,
    uri: row.uri,
    name: row.name,
    beverage: row.beverage,
    visibility: row.visibility,
    owner: owner as NonNullable<typeof owner>,
    credit: imported
      ? {
          sourceUrl: row.creditSourceUrl,
          site: row.creditSite,
          author: row.creditAuthor,
          importedAt: iso(row.creditImportedAt),
          license: row.creditLicense,
        }
      : null,
    forkedFrom: row.forkedFromUri
      ? { uri: row.forkedFromUri, recipeId: row.forkedFromRecipeId }
      : null,
    publicSharingBlocked: row.publicSharingBlocked,
    latestVersion: row.latestVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createRecipeService(
  db: Db,
  opts: { baseUrl: string; profiles: EquipmentProfileService },
) {
  const { profiles } = opts;

  /** Loads a recipe and checks `action`; locks the row for updates when asked. */
  async function authorize(tx: Tx, user: User | null, action: Action, id: string, lock = false) {
    const query = tx
      .select({ recipe: recipes, latestVersion })
      .from(recipes)
      .where(eq(recipes.id, id));
    const [row] = await (lock ? query.for("update", { of: recipes }) : query);
    if (!row) throw new ApiError(404, "not_found", "Recipe not found");
    await authorizeRow(tx, user, action, "recipe", row.recipe, "Recipe");
    return { ...row.recipe, latestVersion: row.latestVersion };
  }

  /** The style must exist; the equipment profile must be one the user can read. */
  async function checkRefs(tx: Tx, user: User, input: z.infer<typeof RecipeVersionInput>) {
    if (input.styleId) {
      const [style] = await tx
        .select({ id: styles.id })
        .from(styles)
        .where(eq(styles.id, input.styleId));
      if (!style) throw new ApiError(400, "unknown_style", "No style with that id");
    }
    if (
      input.equipmentProfileId &&
      !(await profiles.readable(tx, user, input.equipmentProfileId))
    ) {
      throw new ApiError(400, "unknown_equipment_profile", "No equipment profile with that id");
    }
  }

  async function insertVersion(
    tx: Tx,
    recipe: { id: string; beverage: RecipeRow["beverage"] },
    version: number,
    input: z.infer<typeof RecipeVersionInput>,
    userId: string,
  ) {
    const [row] = await tx
      .insert(recipeVersions)
      .values({
        recipeId: recipe.id,
        version,
        name: input.name,
        beverage: recipe.beverage,
        styleId: input.styleId ?? null,
        batchSizeL: input.batchSizeL,
        equipmentProfileId: input.equipmentProfileId ?? null,
        content: input.content,
        createdByUserId: userId,
      })
      .returning();
    return row as VersionRow;
  }

  async function viewVersion(tx: Tx, row: VersionRow) {
    const { content, ...computed } = await versionStats(tx, row);
    let fit = null;
    if (row.styleId) {
      const [style] = await tx.select().from(styles).where(eq(styles.id, row.styleId));
      if (style) fit = styleFit(computed.stats ?? {}, style);
    }
    return {
      id: row.id,
      version: row.version,
      name: row.name,
      beverage: row.beverage,
      styleId: row.styleId,
      batchSizeL: row.batchSizeL,
      equipmentProfileId: row.equipmentProfileId,
      content,
      createdAt: row.createdAt.toISOString(),
      ...computed,
      styleFit: fit,
    };
  }

  async function versionRow(tx: Tx, recipeId: string, version: number) {
    const [row] = await tx
      .select()
      .from(recipeVersions)
      .where(and(eq(recipeVersions.recipeId, recipeId), eq(recipeVersions.version, version)));
    if (!row) throw new ApiError(404, "not_found", "Recipe version not found");
    return row;
  }

  async function detail(tx: Tx, recipe: RecipeRow & { latestVersion: number }) {
    const version = await viewVersion(tx, await versionRow(tx, recipe.id, recipe.latestVersion));
    return { ...viewRecipe(recipe), version };
  }

  async function insertRecipe(
    tx: Tx,
    user: User,
    values: Omit<typeof recipes.$inferInsert, "id" | "uri" | "ownerUserId" | "ownerBreweryId">,
    version: z.infer<typeof RecipeVersionInput>,
    breweryId?: string,
  ) {
    const owner = newOwner(user, breweryId);
    await checkRefs(tx, user, version);
    const id = await newId(tx);
    const [recipe] = await tx
      .insert(recipes)
      .values({ ...values, id, uri: `${opts.baseUrl}/recipes/${id}`, ...owner })
      .returning();
    const row = { ...(recipe as RecipeRow), latestVersion: 1 };
    await insertVersion(tx, row, 1, version, user.id);
    return detail(tx, row);
  }

  return {
    /**
     * What the user can read, newest first. Unlisted recipes only show to their owner, their
     * brewery and people they're shared with, never in search.
     */
    async list(
      viewer: User | null,
      page: { q?: string | undefined; mine: boolean; limit: number; offset: number },
    ) {
      if (page.mine && !viewer) throw new ApiError(401, "unauthorized", "Sign in first");
      const access =
        page.mine && viewer
          ? eq(recipes.ownerUserId, viewer.id)
          : readableBy(db, viewer, "recipe", recipes);
      const search = page.q ? sql`strpos(lower(${recipes.name}), lower(${page.q})) > 0` : undefined;
      const rows = await db
        .select({ recipe: recipes, latestVersion })
        .from(recipes)
        .where(and(access, search))
        .orderBy(desc(recipes.updatedAt), desc(recipes.id))
        .limit(page.limit + 1)
        .offset(page.offset);
      return {
        items: rows
          .slice(0, page.limit)
          .map((r) => viewRecipe({ ...r.recipe, latestVersion: r.latestVersion })),
        nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
      };
    },

    async create(viewer: User | null, input: z.infer<typeof CreateRecipe>) {
      const user = signedIn(viewer);
      const { credit } = input;
      return db.transaction((tx) =>
        insertRecipe(
          tx,
          user,
          {
            name: input.name,
            beverage: input.beverage,
            visibility: input.visibility,
            ...(credit && {
              creditSourceUrl: credit.sourceUrl,
              creditSite: credit.site ?? null,
              creditAuthor: credit.author ?? null,
              creditLicense: credit.license ?? null,
              creditImportedAt: new Date(),
              publicSharingBlocked: credit.publicSharingBlocked,
            }),
          },
          input,
          input.breweryId,
        ),
      );
    },

    async get(viewer: User | null, id: string) {
      return db.transaction(async (tx) => detail(tx, await authorize(tx, viewer, "read", id)));
    },

    async versions(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        await authorize(tx, viewer, "read", id);
        const rows = await tx
          .select({
            id: recipeVersions.id,
            version: recipeVersions.version,
            name: recipeVersions.name,
            createdAt: recipeVersions.createdAt,
          })
          .from(recipeVersions)
          .where(eq(recipeVersions.recipeId, id))
          .orderBy(desc(recipeVersions.version));
        return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
      });
    },

    async version(viewer: User | null, id: string, version: number) {
      return db.transaction(async (tx) => {
        await authorize(tx, viewer, "read", id);
        return viewVersion(tx, await versionRow(tx, id, version));
      });
    },

    async versionForExport(viewer: User | null, id: string, version: number) {
      return db.transaction(async (tx) => {
        const recipe = await authorize(tx, viewer, "read", id);
        const row = await versionRow(tx, id, version);
        const { name, beverage, styleId, batchSizeL } = row;
        const [style] = styleId ? await tx.select().from(styles).where(eq(styles.id, styleId)) : [];
        const { credit } = viewRecipe(recipe);
        return {
          style,
          name,
          beverage,
          styleId,
          batchSizeL,
          content: RecipeContent.parse(row.content),
          ...(credit && {
            credit: {
              sourceUrl: credit.sourceUrl,
              ...(credit.site && { site: credit.site }),
              ...(credit.author && { author: credit.author }),
              ...(credit.license && { license: credit.license }),
              publicSharingBlocked: recipe.publicSharingBlocked,
            },
          }),
        };
      });
    },

    /** Saving never changes a version: it adds the next one. */
    async saveVersion(viewer: User | null, id: string, input: z.infer<typeof RecipeVersionInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const recipe = await authorize(tx, user, "edit", id, true);
        await checkRefs(tx, user, input);
        const row = await insertVersion(tx, recipe, recipe.latestVersion + 1, input, user.id);
        await tx.update(recipes).set({ name: input.name }).where(eq(recipes.id, id));
        return viewVersion(tx, row);
      });
    },

    /**
     * Unlisted and public both reach people without an account, so both count as sharing
     * publicly: refused when the source forbids it, and confirmed for anything imported.
     */
    async setVisibility(viewer: User | null, id: string, patch: z.infer<typeof RecipePatch>) {
      return db.transaction(async (tx) => {
        const recipe = await authorize(tx, viewer, "share", id, true);
        if (patch.visibility === "public" || patch.visibility === "unlisted") {
          if (recipe.publicSharingBlocked) {
            throw new ApiError(
              409,
              "public_sharing_blocked",
              "This recipe's source doesn't allow sharing it publicly",
            );
          }
          if (viewRecipe(recipe).credit && !patch.confirmPublic) {
            throw new ApiError(
              400,
              "confirm_public",
              "This recipe was imported: confirm its source allows public sharing (confirmPublic)",
            );
          }
        }
        const [row] = await tx
          .update(recipes)
          .set({ visibility: patch.visibility })
          .where(eq(recipes.id, id))
          .returning();
        return viewRecipe({ ...(row as RecipeRow), latestVersion: recipe.latestVersion });
      });
    },

    async remove(viewer: User | null, id: string) {
      try {
        await db.transaction(async (tx) => {
          await authorize(tx, viewer, "delete", id, true);
          await tx
            .delete(shares)
            .where(and(eq(shares.resourceType, "recipe"), eq(shares.resourceId, id)));
          await tx.delete(recipes).where(eq(recipes.id, id));
        });
      } catch (err) {
        // Batches point at versions with ON DELETE RESTRICT (restrict_violation).
        if (pgCode(err) === "23001") {
          throw new ApiError(409, "recipe_in_use", "Batches were made from this recipe");
        }
        throw err;
      }
    },

    /** A private copy owned by the forker; the original's URI and any import credit stay on it. */
    async fork(viewer: User | null, id: string, input: z.infer<typeof ForkInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const original = await authorize(tx, user, "read", id);
        const latest = await versionRow(tx, id, original.latestVersion);
        const name = input.name ?? original.name;
        const profileId =
          latest.equipmentProfileId &&
          (await profiles.readable(tx, user, latest.equipmentProfileId))
            ? latest.equipmentProfileId
            : null;
        return insertRecipe(
          tx,
          user,
          {
            name,
            beverage: original.beverage,
            visibility: "private",
            creditSourceUrl: original.creditSourceUrl,
            creditSite: original.creditSite,
            creditAuthor: original.creditAuthor,
            creditImportedAt: original.creditImportedAt,
            creditLicense: original.creditLicense,
            publicSharingBlocked: original.publicSharingBlocked,
            forkedFromUri: original.uri,
            forkedFromRecipeId: original.id,
          },
          {
            name,
            styleId: latest.styleId,
            batchSizeL: latest.batchSizeL,
            equipmentProfileId: profileId,
            content: RecipeContent.parse(latest.content),
          },
        );
      });
    },

    /** A draft of the recipe on another equipment profile; nothing is saved. */
    async scale(viewer: User | null, id: string, input: z.infer<typeof ScaleInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const recipe = await authorize(tx, user, "read", id);
        const row = await versionRow(tx, id, input.version ?? recipe.latestVersion);
        const target = await profiles.readable(tx, user, input.equipmentProfileId);
        if (!target) {
          throw new ApiError(400, "unknown_equipment_profile", "No equipment profile with that id");
        }
        if (target.batchSizeL === null) {
          throw new ApiError(400, "profile_incomplete", "The equipment profile needs a batch size");
        }
        const content = RecipeContent.parse(row.content);
        const fromEfficiency = efficiencyOf(content, await equipmentOf(tx, row.equipmentProfileId));
        const scaled = RecipeContent.safeParse(
          scaleContent(
            content,
            { batchSizeL: row.batchSizeL, efficiencyPct: fromEfficiency },
            {
              batchSizeL: target.batchSizeL,
              efficiencyPct: target.efficiencyPct ?? fromEfficiency,
            },
          ),
        );
        if (!scaled.success) {
          throw new ApiError(400, "cannot_scale", "The scaled amounts are out of range");
        }
        return {
          batchSizeL: target.batchSizeL,
          equipmentProfileId: target.id,
          content: scaled.data,
          ...computeStats(
            scaled.data,
            target.batchSizeL,
            target,
            await catalogValues(tx, scaled.data),
          ),
        };
      });
    },

    async listShares(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        await authorize(tx, viewer, "share", id);
        const rows = await tx
          .select({ share: shares, userId: users.id, displayName: users.displayName })
          .from(shares)
          .leftJoin(users, eq(users.id, shares.toUserId))
          .where(and(eq(shares.resourceType, "recipe"), eq(shares.resourceId, id)))
          .orderBy(shares.createdAt);
        return rows.map((r) => ({
          id: r.share.id,
          user: r.userId ? { id: r.userId, displayName: r.displayName as string } : null,
          breweryId: r.share.toBreweryId,
          level: r.share.level,
          createdAt: r.share.createdAt.toISOString(),
        }));
      });
    },

    /** Shares with a user (by email) or a brewery; sharing again changes the level. */
    async share(viewer: User | null, id: string, input: z.infer<typeof ShareInput>) {
      return db.transaction(async (tx) => {
        const recipe = await authorize(tx, viewer, "share", id);
        let to: { toUserId: string } | { toBreweryId: string };
        let user: { id: string; displayName: string } | null = null;
        if (input.email !== undefined) {
          [user = null] = await tx
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(sql`lower(${users.email}) = lower(${input.email})`);
          if (!user) throw new ApiError(404, "user_not_found", "No account with that email here");
          if (user.id === recipe.ownerUserId) {
            throw new ApiError(400, "cannot_share_with_owner", "That's the recipe's owner");
          }
          to = { toUserId: user.id };
        } else {
          const breweryId = input.breweryId as string;
          const [brewery] = await tx
            .select({ id: breweries.id })
            .from(breweries)
            .where(eq(breweries.id, breweryId));
          if (!brewery) throw new ApiError(404, "brewery_not_found", "No brewery with that id");
          to = { toBreweryId: breweryId };
        }
        const [row] = await tx
          .insert(shares)
          .values({ resourceType: "recipe", resourceId: id, level: input.level, ...to })
          .onConflictDoUpdate({
            target: [shares.resourceType, shares.resourceId, shares.toUserId, shares.toBreweryId],
            set: { level: input.level },
          })
          .returning();
        const share = row as typeof shares.$inferSelect;
        return {
          id: share.id,
          user,
          breweryId: share.toBreweryId,
          level: share.level,
          createdAt: share.createdAt.toISOString(),
        };
      });
    },

    async unshare(viewer: User | null, id: string, shareId: string) {
      await db.transaction(async (tx) => {
        await authorize(tx, viewer, "share", id);
        const removed = await tx
          .delete(shares)
          .where(
            and(
              eq(shares.id, shareId),
              eq(shares.resourceType, "recipe"),
              eq(shares.resourceId, id),
            ),
          )
          .returning({ id: shares.id });
        if (!removed.length) throw new ApiError(404, "not_found", "Share not found");
      });
    },
  };
}

export type RecipeService = ReturnType<typeof createRecipeService>;
