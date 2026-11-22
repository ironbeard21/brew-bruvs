// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CatalogName, catalogTables, schema } from "@brew-bruvs/db";
import { z } from "@hono/zod-openapi";

export const CatalogNameSchema = z.enum(Object.keys(catalogTables) as CatalogName[]);

const common = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  sources: z.array(z.string()),
  licenses: z.array(z.string()),
  notes: z.string().nullable(),
});
const text = z.string().nullable();
const number = z.number().nullable();
const beverage = z.enum(schema.beverage.enumValues);
const beverages = z.array(beverage);

export const CatalogItem = z
  .discriminatedUnion("catalog", [
    common
      .extend({
        catalog: z.literal("hops"),
        origin: text,
        hopType: text,
        alphaAcidPct: number,
        alphaAcidMinPct: number,
        alphaAcidMaxPct: number,
        betaAcidPct: number,
        cohumulonePct: number,
        totalOilMlPer100g: number,
        myrcenePct: number,
        humulenePct: number,
        caryophyllenePct: number,
        farnesenePct: number,
        hsi: number,
        substitutes: text,
        beverages,
      })
      .openapi("CatalogHop"),
    common
      .extend({
        catalog: z.literal("fermentables"),
        fermentableType: text,
        producer: text,
        productId: text,
        origin: text,
        category: text,
        colorEbc: number,
        yieldPct: number,
        potentialSg: number.meta({
          description: "Specific gravity of 1 lb in 1 US gal, e.g. 1.037.",
        }),
        maxInBatchPct: number,
        diastaticPowerLintner: number,
        proteinPct: number,
        moisturePct: number,
        beverages,
      })
      .openapi("CatalogFermentable"),
    common
      .extend({
        catalog: z.literal("yeasts"),
        producer: text,
        productId: text,
        yeastType: text,
        form: text,
        tempMinC: number,
        tempMaxC: number,
        attenuationMinPct: number,
        attenuationMaxPct: number,
        flocculation: text,
        alcoholTolerancePct: number,
        bestFor: text,
        beverages,
      })
      .openapi("CatalogYeast"),
    common
      .extend({
        catalog: z.literal("miscs"),
        miscType: text,
        waterAgentType: text,
        use: text,
        useFor: text,
        category: text,
        beverages,
      })
      .openapi("CatalogMisc"),
    common
      .extend({
        catalog: z.literal("styles"),
        styleGuide: z.string(),
        styleId: z.string(),
        category: text,
        beverage,
        ogMin: number,
        ogMax: number,
        fgMin: number,
        fgMax: number,
        ibuMin: number,
        ibuMax: number,
        colorEbcMin: number,
        colorEbcMax: number,
        abvMinPct: number,
        abvMaxPct: number,
        carbVolsMin: number,
        carbVolsMax: number,
      })
      .openapi("CatalogStyle"),
    common
      .extend({
        catalog: z.literal("water_profiles"),
        calciumPpm: number,
        magnesiumPpm: number,
        sodiumPpm: number,
        sulfatePpm: number,
        chloridePpm: number,
        bicarbonatePpm: number,
      })
      .openapi("CatalogWaterProfile"),
    common
      .extend({
        catalog: z.literal("equipment"),
        category: text,
        batchSizeL: number,
        boilSizeL: number,
        kettleVolumeL: number,
        kettleLossL: number,
        boilRateLPerHr: number,
        mashTunVolumeL: number,
        grainAbsorptionLPerKg: number,
      })
      .openapi("CatalogEquipment"),
  ])
  .openapi("CatalogItem");

export const CatalogPage = z
  .object({
    items: z.array(CatalogItem),
    nextOffset: z.int().nonnegative().nullable(),
  })
  .openapi("CatalogPage");

const CatalogSource = z
  .object({
    name: z.string(),
    url: z.string().meta({ description: "Source URL or local source reference." }),
    license: z.string(),
    commit: z.string().nullable(),
  })
  .openapi("CatalogSource");

export const CatalogAttribution = z
  .object({
    sources: z
      .record(z.string(), CatalogSource)
      .meta({ description: "Sources keyed by their catalog source ID." }),
    attribution: z.string().meta({ description: "Catalog attribution in Markdown." }),
  })
  .openapi("CatalogAttribution");
