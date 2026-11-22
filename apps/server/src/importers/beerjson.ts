// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { z } from "zod";
import type { RecipeContent } from "../contracts/recipe-content.ts";
import type { RecipeFile } from "../contracts/recipe-file.ts";
import {
  type FileStyle,
  fileCredit,
  invalidFile,
  parseRecipe,
  restoreRecipe,
  styleCode,
  writeExtras,
} from "./recipe-file.ts";

const quantity = z.object({ unit: z.string(), value: z.number() });
const timing = z.object({
  use: z.string().optional(),
  time: quantity.optional(),
  duration: quantity.optional(),
  step: z.int().optional(),
});
const addition = z.object({
  name: z.string(),
  type: z.string().optional(),
  form: z.string().optional(),
  amount: quantity,
  timing: timing.optional(),
});
const procedureStep = z.object({
  name: z.string(),
  description: z.string().optional(),
  step_time: quantity.optional(),
  start_temperature: quantity.optional(),
});
const record = z.object({
  name: z.string(),
  type: z.string(),
  author: z.string().optional(),
  batch_size: quantity,
  notes: z.string().optional(),
  efficiency: z.object({ brewhouse: quantity }).optional(),
  boil: z.object({ boil_time: quantity }).optional(),
  original_gravity: quantity.optional(),
  final_gravity: quantity.optional(),
  alcohol_by_volume: quantity.optional(),
  ibu_estimate: z.object({ value: z.number().optional() }).optional(),
  color_estimate: quantity.optional(),
  beer_pH: quantity.optional(),
  carbonation: z.number().optional(),
  ingredients: z.object({
    fermentable_additions: z
      .array(
        addition.extend({
          yield: z
            .object({ potential: quantity.optional(), fine_grind: quantity.optional() })
            .optional(),
          color: quantity.optional(),
        }),
      )
      .default([]),
    hop_additions: z.array(addition.extend({ alpha_acid: quantity.optional() })).default([]),
    culture_additions: z.array(addition.extend({ attenuation: quantity.optional() })).default([]),
    miscellaneous_additions: z.array(addition).default([]),
    water_additions: z.array(addition).default([]),
  }),
  mash: z
    .object({
      mash_steps: z.array(
        procedureStep.extend({
          type: z.string(),
          step_temperature: quantity,
          step_time: quantity,
          amount: quantity.optional(),
        }),
      ),
    })
    .optional(),
  fermentation: z.object({ fermentation_steps: z.array(procedureStep) }).optional(),
});
const document = z.object({
  beerjson: z.object({
    version: z.literal(1),
    recipes: z.tuple([z.record(z.string(), z.unknown())]),
  }),
});

const massUnits = z.enum(["mg", "g", "kg", "lb", "oz"]);
const volumeUnits = z.enum([
  "ml",
  "l",
  "tsp",
  "tbsp",
  "floz",
  "cup",
  "pt",
  "qt",
  "gal",
  "bbl",
  "ifloz",
  "ipt",
  "iqt",
  "igal",
  "ibbl",
]);
const timeUnits = z.enum(["sec", "min", "hr", "day", "week"]);
const countUnits = z.enum(["1", "unit", "each", "dimensionless", "pkg"]);
const fermentableKinds = z.enum([
  "grain",
  "extract",
  "sugar",
  "honey",
  "juice",
  "fruit",
  "adjunct",
  "other",
]);
const hopForms = z.enum(["pellet", "leaf", "plug", "extract"]);
const yeastForms = z.enum(["dry", "liquid", "slurry", "culture"]);
const miscKinds = z.enum([
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
]);
const mashTypes = z.enum(["infusion", "temperature", "decoction"]);
const fermentationStages = z.enum([
  "primary",
  "secondary",
  "conditioning",
  "lagering",
  "cold_crash",
  "bulk_aging",
  "bottle_aging",
  "other",
]);
const extrasMarker = /\n\n<!-- brew-bruvs-v1:([\w-]+) -->$/;

type Quantity = z.infer<typeof quantity>;
type Timing = z.infer<typeof timing>;

const liters = (q: Quantity) => units.volumeToLiters(q.value, volumeUnits.parse(q.unit));
const kg = (q: Quantity) => units.massToKg(q.value, massUnits.parse(q.unit));
const min = (q?: Quantity) => q && units.timeToMinutes(q.value, timeUnits.parse(q.unit));
const days = (q?: Quantity) =>
  q && units.minutesToDays(units.timeToMinutes(q.value, timeUnits.parse(q.unit)));
const celsius = (q?: Quantity) =>
  q && (z.enum(["C", "F"]).parse(q.unit) === "C" ? q.value : units.fToC(q.value));
const percent = (q?: Quantity) =>
  q && z.object({ unit: z.literal("%"), value: z.number() }).parse(q).value;
const gravity = (q?: Quantity) => {
  if (!q) return undefined;
  return z.enum(["sg", "plato", "brix"]).parse(q.unit) === "sg"
    ? q.value
    : units.platoToSg(q.value);
};
const ebc = (q?: Quantity) => {
  if (!q) return undefined;
  switch (z.enum(["EBC", "SRM", "Lovi"]).parse(q.unit)) {
    case "EBC":
      return q.value;
    case "SRM":
      return units.srmToEbc(q.value);
    case "Lovi":
      return units.srmToEbc(units.lovibondToSrm(q.value));
  }
};
const pH = (q?: Quantity) =>
  q && z.object({ unit: z.literal("pH"), value: z.number() }).parse(q).value;
const measure = (value: number | undefined, unit: string) =>
  value === undefined ? undefined : { value, unit };

function amount(q: Quantity) {
  return volumeUnits.safeParse(q.unit).success ? { amountL: liters(q) } : { amountKg: kg(q) };
}

const fermentableUse = {
  add_to_mash: "mash",
  add_to_boil: "boil",
  add_to_fermentation: "fermentation",
  add_to_package: "package",
} as const;
const hopUse = {
  add_to_mash: "mash",
  add_to_boil: "boil",
  add_to_fermentation: "dry_hop",
} as const;
const miscUse = { add_to_mash: "mash", add_to_boil: "boil", add_to_package: "bottling" } as const;

function lookup<T extends string>(entries: Record<string, T>, key?: string): T | undefined {
  return key !== undefined && Object.hasOwn(entries, key) ? entries[key] : undefined;
}

function readStandard(raw: unknown): RecipeFile {
  const data = record.parse(raw);
  const type = z
    .enum(["cider", "mead", "wine", "extract", "partial mash", "all grain"])
    .parse(data.type);
  const author = data.author?.trim();
  const boilTimeMin = min(data.boil?.boil_time);
  const targets = {
    og: gravity(data.original_gravity),
    fg: gravity(data.final_gravity),
    abvPct: percent(data.alcohol_by_volume),
    ibu: data.ibu_estimate?.value,
    colorEbc: ebc(data.color_estimate),
    ph: pH(data.beer_pH),
    carbonationVols: data.carbonation,
  };
  return parseRecipe({
    name: data.name,
    beverage: type === "cider" || type === "mead" || type === "wine" ? type : "beer",
    batchSizeL: liters(data.batch_size),
    credit: fileCredit(author),
    content: {
      schemaVersion: 1,
      efficiencyPct: percent(data.efficiency?.brewhouse) || undefined,
      boilTimeMin,
      notes: data.notes,
      targets: Object.values(targets).some((value) => value !== undefined) ? targets : undefined,
      fermentables: data.ingredients.fermentable_additions.map((line) => ({
        name: line.name,
        kind:
          fermentableKinds.safeParse(line.type === "dry extract" ? "extract" : line.type).data ??
          "other",
        ...amount(line.amount),
        use: lookup(fermentableUse, line.timing?.use),
        dayOffset: line.timing?.use === "add_to_fermentation" ? days(line.timing.time) : undefined,
        potentialSg: gravity(line.yield?.potential),
        yieldPct: percent(line.yield?.fine_grind),
        colorEbc: ebc(line.color),
      })),
      hops: data.ingredients.hop_additions.map((line) => {
        if (volumeUnits.safeParse(line.amount.unit).success) {
          invalidFile(
            `Hop "${line.name}" needs a weight. A volume cannot be converted without its density.`,
          );
        }
        const use = lookup(hopUse, line.timing?.use) ?? "boil";
        const time = min(line.timing?.time);
        return {
          name: line.name,
          amountKg: kg(line.amount),
          use,
          alphaAcidPct: percent(line.alpha_acid),
          form: hopForms.safeParse(line.form === "leaf (wet)" ? "leaf" : line.form).data,
          timeMin:
            use === "boil"
              ? (min(line.timing?.duration) ??
                (time === undefined ? 0 : Math.max(0, (boilTimeMin ?? time) - time)))
              : undefined,
          days: use === "dry_hop" ? days(line.timing?.duration) : undefined,
        };
      }),
      yeasts: data.ingredients.culture_additions.map((line) => ({
        name: line.name,
        form: yeastForms.safeParse(line.form).data,
        attenuationPct: percent(line.attenuation),
        ...(line.amount.value === 0
          ? {}
          : countUnits.safeParse(line.amount.unit).success
            ? { packs: line.amount.value }
            : amount(line.amount)),
      })),
      miscs: [
        ...data.ingredients.miscellaneous_additions.map((line) => {
          const use =
            lookup(miscUse, line.timing?.use) ??
            ((line.timing?.step ?? 1) > 1 ? "secondary" : "primary");
          return {
            name: line.name,
            kind:
              miscKinds.safeParse(
                line.type === "water agent"
                  ? "water_agent"
                  : line.type === "wood"
                    ? "oak"
                    : line.type,
              ).data ?? "other",
            use,
            ...(countUnits.safeParse(line.amount.unit).success
              ? { count: line.amount.value }
              : amount(line.amount)),
            timeMin: use === "boil" || use === "mash" ? min(line.timing?.duration) : undefined,
            dayOffset:
              line.timing?.use === "add_to_fermentation" ? days(line.timing.time) : undefined,
          };
        }),
        ...data.ingredients.water_additions.map((line) => ({
          name: line.name,
          kind: "water_agent",
          use: lookup(miscUse, line.timing?.use) ?? "mash",
          amountL: liters(line.amount),
        })),
      ],
      mash:
        data.mash?.mash_steps.map((step) => ({
          name: step.name,
          type: mashTypes.safeParse(step.type).data ?? "temperature",
          tempC: celsius(step.step_temperature),
          timeMin: min(step.step_time),
          infuseL: step.amount && liters(step.amount),
        })) ?? [],
      fermentation:
        data.fermentation?.fermentation_steps.map((step, index) => ({
          name: step.name,
          stage:
            fermentationStages.safeParse(step.name.toLowerCase().replace(/\s+/g, "_")).data ??
            (index === 0 ? "primary" : index === 1 ? "secondary" : "other"),
          tempC: celsius(step.start_temperature),
          days: days(step.step_time),
          note: step.description,
        })) ?? [],
    },
  });
}

export function importBeerJson(source: string) {
  try {
    const parsed = document.safeParse(JSON.parse(source.replace(/^\uFEFF/, "")));
    if (!parsed.success) invalidFile("Expected a BeerJSON 1.0 document with exactly one recipe");
    const [raw] = parsed.data.beerjson.recipes;
    const note = typeof raw.notes === "string" ? raw.notes : undefined;
    const marker = note?.match(extrasMarker);
    if (marker?.[1]) {
      const standardNotes = (note ?? "").slice(0, marker.index);
      const original = { ...raw, notes: standardNotes };
      return restoreRecipe(original, Buffer.from(marker[1], "base64url").toString("utf8"), () =>
        readStandard(original),
      );
    }
    return { recipe: readStandard(raw), native: false };
  } catch (error) {
    if (error instanceof SyntaxError) invalidFile("Invalid BeerJSON syntax");
    if (error instanceof z.ZodError)
      invalidFile(`Invalid BeerJSON field: ${error.issues[0]?.path.join(".") || "recipe"}`);
    throw error;
  }
}

const timingFor = (use: string, duration?: Quantity, time?: Quantity, step?: number): Timing => ({
  use,
  duration,
  time,
  step,
});
const standardAmount = (line: {
  amountKg?: number | undefined;
  amountL?: number | undefined;
  count?: number | undefined;
}) => measure(line.amountKg, "kg") ?? measure(line.amountL, "l") ?? measure(line.count, "each");

function writeIngredients(content: RecipeContent, beverage: RecipeFile["beverage"]) {
  return {
    fermentable_additions: content.fermentables.map((line) => ({
      name: line.name,
      type: line.kind === "adjunct" ? "other" : line.kind,
      amount: standardAmount(line),
      color: measure(line.colorEbc ?? 0, "EBC"),
      yield:
        line.potentialSg === undefined && line.yieldPct === undefined
          ? { fine_grind: measure(0, "%") }
          : { potential: measure(line.potentialSg, "sg"), fine_grind: measure(line.yieldPct, "%") },
      timing:
        line.use &&
        timingFor(
          {
            mash: "add_to_mash",
            steep: "add_to_mash",
            boil: "add_to_boil",
            fermentation: "add_to_fermentation",
            package: "add_to_package",
          }[line.use],
          undefined,
          measure(line.dayOffset, "day"),
        ),
    })),
    hop_additions: content.hops.map((line) => ({
      name: line.name,
      form: line.form,
      alpha_acid: measure(line.alphaAcidPct ?? 0, "%"),
      amount: measure(line.amountKg, "kg"),
      timing: timingFor(
        line.use === "mash"
          ? "add_to_mash"
          : line.use === "dry_hop"
            ? "add_to_fermentation"
            : "add_to_boil",
        line.use === "dry_hop" ? measure(line.days, "day") : measure(line.timeMin, "min"),
      ),
    })),
    culture_additions: content.yeasts.map((line) => ({
      name: line.name,
      type: beverage === "beer" ? "other" : "wine",
      form: line.form === "slurry" ? "liquid" : (line.form ?? "culture"),
      amount: standardAmount(line) ?? measure(line.packs ?? 0, "pkg"),
      attenuation: measure(line.attenuationPct, "%"),
    })),
    miscellaneous_additions: content.miscs.map((line) => ({
      name: line.name,
      type:
        line.kind === "water_agent"
          ? "water agent"
          : line.kind === "oak"
            ? "wood"
            : ["spice", "herb", "flavor", "fining"].includes(line.kind)
              ? line.kind
              : "other",
      amount: standardAmount(line),
      timing: timingFor(
        line.use === "mash"
          ? "add_to_mash"
          : line.use === "boil"
            ? "add_to_boil"
            : line.use === "bottling"
              ? "add_to_package"
              : "add_to_fermentation",
        measure(line.timeMin, "min"),
        measure(line.dayOffset, "day"),
        line.use === "secondary" || line.use === "bulk_aging" ? 2 : undefined,
      ),
    })),
  };
}

export function exportBeerJson(recipe: RecipeFile, style?: FileStyle): string {
  const { content, beverage } = recipe;
  const t = content.targets;
  const code = style && styleCode(style.styleId);
  const standard = {
    name: recipe.name,
    type: beverage === "beer" ? (content.mash.length ? "all grain" : "extract") : beverage,
    author: recipe.credit?.author ?? "",
    batch_size: measure(recipe.batchSizeL, "l"),
    style: style && {
      name: style.name,
      category: style.category ?? "",
      style_guide: style.styleGuide,
      type: beverage,
      category_number: code?.category ? Number(code.category) : undefined,
      style_letter: code?.letter,
    },
    efficiency: { brewhouse: measure(content.efficiencyPct ?? 0, "%") },
    ingredients: writeIngredients(content, beverage),
    boil:
      content.boilTimeMin === undefined
        ? undefined
        : { boil_time: measure(content.boilTimeMin, "min") },
    mash: content.mash.length
      ? {
          name: "Mash",
          grain_temperature: measure(content.mash[0]?.tempC ?? 0, "C"),
          mash_steps: content.mash.map((step) => ({
            name: step.name,
            type: step.type,
            amount: measure(step.infuseL, "l"),
            step_temperature: measure(step.tempC, "C"),
            step_time: measure(step.timeMin, "min"),
          })),
        }
      : undefined,
    fermentation: content.fermentation.length
      ? {
          name: "Fermentation",
          fermentation_steps: content.fermentation.map((step) => ({
            name: step.name,
            description: step.note,
            start_temperature: measure(step.tempC, "C"),
            step_time: measure(step.days, "day"),
          })),
        }
      : undefined,
    original_gravity: measure(t?.og, "sg"),
    final_gravity: measure(t?.fg, "sg"),
    alcohol_by_volume: measure(t?.abvPct, "%"),
    ibu_estimate: t?.ibu === undefined ? undefined : { method: "Other", value: t.ibu },
    color_estimate: measure(t?.colorEbc, "EBC"),
    beer_pH: measure(t?.ph, "pH"),
    carbonation: t?.carbonationVols,
    notes: content.notes ?? "",
  };
  // BeerJSON 1.0 disallows extra recipe properties. Put lossless round-trip data in a notes trailer.
  const extra = Buffer.from(writeExtras(standard, recipe)).toString("base64url");
  return JSON.stringify(
    {
      beerjson: {
        version: 1,
        recipes: [
          {
            ...standard,
            notes: `${standard.notes}\n\n<!-- brew-bruvs-v1:${extra} -->`,
          },
        ],
      },
    },
    null,
    2,
  );
}
