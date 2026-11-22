// SPDX-License-Identifier: AGPL-3.0-or-later
// The recipe document stored in `recipe_versions.content`, for beer, mead, wine and cider.
// Contract: published as the OpenAPI component RecipeContent and as
// packages/api-contract/recipe-content.schema.json (both written by `pnpm api:generate`).
//
// Units: mass kg, volume L, temperature °C, gravity SG, colour EBC, time in minutes or days as
// the field name says. Every ingredient line has a name and works with or without a catalog id;
// per-recipe values (alpha acid, potential, colour, attenuation) override the catalog's.
import { z } from "@hono/zod-openapi";

const name = z.string().trim().min(1).max(200);
const catalogId = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .meta({ description: 'Catalog row id, e.g. "hop-citra". Omit for free-text lines.' });
const kg = z.number().positive().max(10_000);
const litres = z.number().positive().max(100_000);
const pct = z.number().min(0).max(100);
const sg = z.number().min(0.98).max(1.3);
const tempC = z.number().min(-10).max(110);
const minutes = z.number().min(0).max(10_000);
const days = z.number().min(0).max(3_650);
const note = z.string().max(2_000).optional();

/** Exactly one of `amountKg` and `amountL`. */
const oneAmount = (line: { amountKg?: number | undefined; amountL?: number | undefined }) =>
  (line.amountKg === undefined) !== (line.amountL === undefined);

export const FermentableLine = z
  .strictObject({
    name,
    catalogId,
    kind: z.enum(["grain", "extract", "sugar", "honey", "juice", "fruit", "adjunct", "other"]),
    amountKg: kg.optional(),
    amountL: litres.optional().meta({ description: "For juices and must measured by volume" }),
    use: z.enum(["mash", "steep", "boil", "fermentation", "package"]).optional(),
    dayOffset: days
      .optional()
      .meta({ description: "For staggered additions: days after pitching" }),
    potentialSg: sg
      .optional()
      .meta({ description: "Per kg in 1 L (grains, sugars, honey) or the juice's own SG" }),
    colorEbc: z.number().min(0).max(5_000).optional(),
    yieldPct: pct.optional(),
    note,
  })
  .refine(oneAmount, { message: "give exactly one of amountKg and amountL" })
  .openapi("FermentableLine");

export const HopLine = z
  .strictObject({
    name,
    catalogId,
    amountKg: kg,
    alphaAcidPct: pct.optional(),
    form: z.enum(["pellet", "leaf", "plug", "extract"]).optional(),
    use: z.enum(["mash", "first_wort", "boil", "whirlpool", "dry_hop"]),
    timeMin: minutes
      .optional()
      .meta({ description: "Boil or whirlpool minutes; required for boil additions" }),
    tempC: tempC.optional().meta({ description: "Whirlpool temperature" }),
    days: days.optional().meta({ description: "Dry-hop contact time" }),
    note,
  })
  .refine((h) => h.use !== "boil" || h.timeMin !== undefined, {
    message: "boil additions need timeMin",
    path: ["timeMin"],
  })
  .openapi("HopLine");

export const YeastLine = z
  .strictObject({
    name,
    catalogId,
    form: z.enum(["dry", "liquid", "slurry", "culture"]).optional(),
    packs: z.number().positive().max(1_000).optional(),
    amountKg: kg.optional(),
    amountL: litres.optional(),
    attenuationPct: pct.optional(),
    note,
  })
  .openapi("YeastLine");

export const MiscLine = z
  .strictObject({
    name,
    catalogId,
    kind: z.enum([
      "spice",
      "herb",
      "flavor",
      "fining",
      "water_agent",
      "nutrient",
      "sulfite",
      "acid",
      "enzyme",
      "tannin",
      "stabilizer",
      "oak",
      "other",
    ]),
    amountKg: kg.optional(),
    amountL: litres.optional(),
    count: z
      .number()
      .positive()
      .max(10_000)
      .optional()
      .meta({ description: "For items counted, e.g. Campden tablets" }),
    use: z.enum(["mash", "boil", "primary", "secondary", "bulk_aging", "bottling"]),
    timeMin: minutes.optional().meta({ description: "Boil or mash minutes" }),
    dayOffset: days
      .optional()
      .meta({ description: "Days after pitching, e.g. staggered nutrient additions" }),
    note,
  })
  .refine((m) => [m.amountKg, m.amountL, m.count].filter((v) => v !== undefined).length === 1, {
    message: "give exactly one of amountKg, amountL and count",
  })
  .openapi("MiscLine");

export const MashStep = z
  .strictObject({
    name,
    type: z.enum(["infusion", "temperature", "decoction"]),
    tempC,
    timeMin: minutes,
    infuseL: litres.optional(),
  })
  .openapi("MashStep");

export const FermentationStep = z
  .strictObject({
    name,
    stage: z.enum([
      "primary",
      "secondary",
      "conditioning",
      "lagering",
      "cold_crash",
      "bulk_aging",
      "bottle_aging",
      "other",
    ]),
    tempC: tempC.optional(),
    days: days.optional(),
    note,
  })
  .openapi("FermentationStep");

export const RecipeTargets = z
  .strictObject({
    og: sg.optional(),
    fg: sg.optional(),
    abvPct: z.number().min(0).max(30).optional(),
    ibu: z.number().min(0).max(300).optional(),
    colorEbc: z.number().min(0).max(1_000).optional(),
    carbonationVols: z.number().min(0).max(6).optional(),
    ph: z.number().min(0).max(14).optional(),
    titratableAcidityGPerL: z.number().min(0).max(50).optional(),
  })
  .openapi("RecipeTargets");

export const RecipeContent = z
  .strictObject({
    schemaVersion: z.literal(1),
    efficiencyPct: z.number().positive().max(100).optional(),
    boilTimeMin: minutes.optional(),
    fermentables: z.array(FermentableLine).max(100),
    hops: z.array(HopLine).max(100),
    yeasts: z.array(YeastLine).max(20),
    miscs: z.array(MiscLine).max(100),
    mash: z.array(MashStep).max(20),
    fermentation: z.array(FermentationStep).max(20),
    targets: RecipeTargets.optional(),
    notes: z.string().max(20_000).optional(),
  })
  .meta({
    description:
      "The recipe document stored with each recipe version. SI units; lines may omit catalogId.",
  })
  .openapi("RecipeContent");

/** JSON Schema (draft 2020-12) of RecipeContent, published for importers and other servers. */
export function recipeContentJsonSchema() {
  return {
    $id: "urn:brew-bruvs:schema:recipe-content:1",
    title: "Brew-Bruvs recipe content, schema version 1",
    ...z.toJSONSchema(RecipeContent, { target: "draft-2020-12" }),
  };
}

export type RecipeContent = z.infer<typeof RecipeContent>;
