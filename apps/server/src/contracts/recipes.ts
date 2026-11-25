// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipes, their immutable versions with computed stats, shares and equipment profiles.
// Units are SI: litres, kg, °C, specific gravity, EBC.
import { z } from "@hono/zod-openapi";
import { RecipeContent } from "./recipe-content.ts";

export const Beverage = z.enum(["beer", "mead", "wine", "cider"]);
export const Visibility = z.enum(["private", "unlisted", "server", "public"]).openapi({
  description:
    "private: owner, brewery and shares only. unlisted: anyone with the link, never listed. server: every signed-in user here. public: anyone.",
});

const litres = z.number().positive().max(100_000);
const loss = z.number().min(0).max(100_000);
const optional = <T extends z.ZodType>(schema: T) => schema.nullable().optional();

// ── Equipment profiles ────────────────────────────────────────────────

const profileFields = {
  catalogId: optional(z.string().min(1).max(200)).openapi({
    description: "The catalog equipment row this profile started from",
  }),
  batchSizeL: optional(litres).openapi({ description: "Volume into the fermenter" }),
  boilSizeL: optional(litres),
  kettleVolumeL: optional(litres),
  kettleLossL: optional(loss),
  boilRateLPerHr: optional(loss),
  mashTunVolumeL: optional(litres),
  grainAbsorptionLPerKg: optional(z.number().min(0).max(5)),
  efficiencyPct: optional(z.number().positive().max(100)),
  fermenterLossL: optional(loss),
};

export const EquipmentProfileInput = z
  .strictObject({ name: z.string().trim().min(1).max(100), ...profileFields })
  .openapi("EquipmentProfileInput");
export const CreateEquipmentProfile = EquipmentProfileInput.extend({
  breweryId: z.uuid().optional().openapi({
    description: "Create it as this brewery's. You must be one of its owners or brewers",
  }),
}).openapi("CreateEquipmentProfile");

export const EquipmentProfilePatch =
  EquipmentProfileInput.partial().openapi("EquipmentProfilePatch");

const nullableNumber = z.number().nullable();
export const EquipmentProfile = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    name: z.string(),
    owner: z.object({ type: z.enum(["user", "brewery"]), id: z.uuid() }),
    catalogId: z.string().nullable(),
    batchSizeL: nullableNumber,
    boilSizeL: nullableNumber,
    kettleVolumeL: nullableNumber,
    kettleLossL: nullableNumber,
    boilRateLPerHr: nullableNumber,
    mashTunVolumeL: nullableNumber,
    grainAbsorptionLPerKg: nullableNumber,
    efficiencyPct: nullableNumber,
    fermenterLossL: nullableNumber,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("EquipmentProfile");

// ── Recipe versions ───────────────────────────────────────────────────

export const RecipeVersionInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    styleId: optional(z.string().min(1).max(200)).openapi({ description: "Catalog style id" }),
    batchSizeL: litres,
    equipmentProfileId: optional(z.uuid()),
    content: RecipeContent,
  })
  .openapi("RecipeVersionInput");

export const RecipeStats = z
  .object({
    og: z.number(),
    fg: z.number(),
    abvPct: z.number(),
    ibu: z.number(),
    colorSrm: z.number(),
    colorEbc: z.number(),
  })
  .openapi("RecipeStats");

const Fit = z.enum(["below", "inside", "above", "unknown"]);
export const StyleFit = z
  .object({ og: Fit, fg: Fit, abvPct: Fit, ibu: Fit, colorEbc: Fit })
  .openapi("StyleFit");

const computed = {
  stats: RecipeStats.nullable().openapi({
    description: "Estimated by brew-math; null when an ingredient is missing a value it needs",
  }),
  statsError: z.string().nullable().openapi({ description: "Why stats is null" }),
};

export const RecipeVersion = z
  .object({
    id: z.uuid(),
    version: z.int().positive(),
    name: z.string(),
    beverage: Beverage,
    styleId: z.string().nullable(),
    batchSizeL: z.number(),
    equipmentProfileId: z.uuid().nullable(),
    content: RecipeContent,
    createdAt: z.string(),
    ...computed,
    styleFit: StyleFit.nullable().openapi({ description: "Set when the version has a style" }),
  })
  .openapi("RecipeVersion");

export const RecipeVersionSummary = z
  .object({ id: z.uuid(), version: z.int().positive(), name: z.string(), createdAt: z.string() })
  .openapi("RecipeVersionSummary");

export const ScaleInput = z
  .strictObject({
    equipmentProfileId: z.uuid(),
    version: z.int().positive().optional().openapi({ description: "Defaults to the latest" }),
  })
  .openapi("ScaleInput");

export const ScaledRecipe = z
  .object({
    batchSizeL: z.number(),
    equipmentProfileId: z.uuid(),
    content: RecipeContent,
    ...computed,
  })
  .openapi("ScaledRecipe", {
    description: "A draft, not saved: post it as a new version to keep it",
  });

// ── Recipes ───────────────────────────────────────────────────────────

export const CreditInput = z
  .strictObject({
    sourceUrl: z.url().max(2_000).nullable().openapi({
      description: "The original source URL, or null for an imported file without a URL",
    }),
    site: z.string().trim().min(1).max(200).optional(),
    author: z.string().trim().min(1).max(200).optional(),
    license: z.string().trim().min(1).max(200).optional(),
    publicSharingBlocked: z.boolean().default(false).openapi({
      description: "Set when the source's terms forbid reuse; the recipe can never be made public",
    }),
  })
  .openapi("CreditInput");

export const CreateRecipe = RecipeVersionInput.extend({
  beverage: Beverage,
  visibility: Visibility.default("private"),
  credit: CreditInput.optional().openapi({
    description: "For imported recipes; permanent once saved",
  }),
  breweryId: z.uuid().optional().openapi({
    description: "Create it as this brewery's. You must be one of its owners or brewers",
  }),
})
  .refine((r) => !r.credit || r.visibility === "private", {
    message: "imported recipes start private",
    path: ["visibility"],
  })
  .openapi("CreateRecipe");

export const Credit = z
  .object({
    sourceUrl: z.string().nullable(),
    site: z.string().nullable(),
    author: z.string().nullable(),
    importedAt: z.string().nullable(),
    license: z.string().nullable(),
  })
  .openapi("Credit");

export const Recipe = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    name: z.string(),
    beverage: Beverage,
    visibility: Visibility,
    owner: z.object({ type: z.enum(["user", "brewery"]), id: z.uuid() }),
    credit: Credit.nullable().openapi({ description: "Import credit; can never be removed" }),
    forkedFrom: z
      .object({
        uri: z.string(),
        recipeId: z.uuid().nullable().openapi({ description: "Null once the original is gone" }),
      })
      .nullable(),
    publicSharingBlocked: z.boolean(),
    latestVersion: z.int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Recipe");

export const RecipeDetail = Recipe.extend({ version: RecipeVersion }).openapi("RecipeDetail");

export const RecipePage = z
  .object({ items: z.array(Recipe), nextOffset: z.int().nullable() })
  .openapi("RecipePage");

export const RecipePatch = z
  .strictObject({
    visibility: Visibility,
    confirmPublic: z.boolean().default(false).openapi({
      description:
        "Required to make an imported or credited recipe unlisted or public: confirms its source allows it",
    }),
  })
  .openapi("RecipePatch");

export const ForkInput = z
  .strictObject({ name: z.string().trim().min(1).max(200).optional() })
  .openapi("ForkInput");

// ── Shares ────────────────────────────────────────────────────────────

const ShareLevel = z.enum(["read", "edit"]);

export const ShareInput = z
  .strictObject({
    email: z.email().max(254).optional().openapi({ description: "A user on this server" }),
    breweryId: z.uuid().optional(),
    level: ShareLevel,
  })
  .refine((s) => (s.email === undefined) !== (s.breweryId === undefined), {
    message: "give exactly one of email and breweryId",
  })
  .openapi("ShareInput");

export const Share = z
  .object({
    id: z.uuid(),
    user: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
    breweryId: z.uuid().nullable(),
    level: ShareLevel,
    createdAt: z.string(),
  })
  .openapi("Share");
