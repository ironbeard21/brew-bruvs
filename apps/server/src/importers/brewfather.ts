// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { z } from "zod";
import { ReadingInput } from "../contracts/batches.ts";
import type { BrewfatherImport } from "../contracts/brewfather.ts";
import { ApiError } from "../errors.ts";

type Entry = Record<string, unknown>;
const records = z.array(z.record(z.string(), z.unknown()));
const record = z.record(z.string(), z.unknown());
const mass = z.enum(["mg", "g", "kg", "lb", "oz"]);
const volume = z.enum(["ml", "l", "tsp", "tbsp", "cup", "pt", "qt", "gal"]);
const text = (value: unknown, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;
const term = (value: unknown) => text(value)?.toLowerCase();
const num = (value: unknown, min = 0, max = Infinity) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
const entries = (value: unknown) => records.parse(value ?? []);
const profile = (value: unknown) => entries(record.safeParse(value).data?.steps);
const ebc = (value: unknown, max: number) =>
  typeof value === "number" ? num(units.srmToEbc(value), 0, max) : undefined;

export function brewfatherDate(value: unknown) {
  const ms = num(value, 1, 253_402_300_799_999);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function requiredText(value: unknown) {
  const name = text(value);
  if (!name)
    throw new ApiError(422, "brewfather_data_invalid", "Brewfather data is missing a name or ID");
  return name;
}

export function brewfatherId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value)) {
    throw new ApiError(422, "brewfather_data_invalid", "Brewfather returned an invalid record ID");
  }
  return value;
}

function quantity(value: unknown, amount: number) {
  const unit = term(value);
  const m = mass.safeParse(unit);
  if (m.success) return { value: units.massToKg(amount, m.data), unit: "kg" } as const;
  const v = volume.safeParse(unit);
  if (v.success) return { value: units.volumeToLiters(amount, v.data), unit: "l" } as const;
  return { value: amount, unit: "each" } as const;
}

const fermentableKind = {
  grain: "grain",
  extract: "extract",
  "dry extract": "extract",
  sugar: "sugar",
  honey: "honey",
  juice: "juice",
  fruit: "fruit",
  adjunct: "adjunct",
} as const;
const fermentableUse = {
  mash: "mash",
  steep: "steep",
  boil: "boil",
  flameout: "boil",
  primary: "fermentation",
  secondary: "fermentation",
  bottling: "package",
} as const;
const hopUse = {
  mash: "mash",
  "first wort": "first_wort",
  boil: "boil",
  aroma: "whirlpool",
  whirlpool: "whirlpool",
  flameout: "whirlpool",
  "dry hop": "dry_hop",
} as const;
const hopForm = {
  pellet: "pellet",
  leaf: "leaf",
  "leaf/whole": "leaf",
  plug: "plug",
  extract: "extract",
} as const;
const miscKind = {
  spice: "spice",
  herb: "herb",
  flavor: "flavor",
  fining: "fining",
  "water agent": "water_agent",
  nutrient: "nutrient",
  acid: "acid",
  enzyme: "enzyme",
  wood: "oak",
} as const;
const miscUse = {
  mash: "mash",
  sparge: "mash",
  steep: "mash",
  boil: "boil",
  flameout: "boil",
  primary: "primary",
  secondary: "secondary",
  bottling: "bottling",
} as const;
const fermentationStage = {
  primary: "primary",
  secondary: "secondary",
  conditioning: "conditioning",
  lagering: "lagering",
  "cold crash": "cold_crash",
  "diacetyl rest": "conditioning",
} as const;

function lookup<T extends string>(map: Readonly<Record<string, T>>, input: unknown): T | undefined {
  const key = term(input);
  return key && Object.hasOwn(map, key) ? map[key] : undefined;
}

function credit(raw: Entry) {
  const source = record.safeParse(raw.source).data;
  const sourceText = text(raw.source);
  const sourceUrl = [raw.sourceUrl, source?.url, raw.source].find(
    (value) =>
      typeof value === "string" &&
      value.length <= 2000 &&
      z.url({ protocol: /^https?$/ }).safeParse(value).success,
  );
  return {
    sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null,
    site:
      text(source?.site ?? raw.sourceSite) ??
      (sourceUrl === undefined ? sourceText : undefined) ??
      "Brewfather",
    author: text(source?.author ?? raw.sourceAuthor ?? raw.author),
    license: text(source?.license ?? raw.sourceLicense),
    publicSharingBlocked:
      source?.publicSharingBlocked === true || raw.publicSharingBlocked === true,
  };
}

export function brewfatherDraft(raw: Entry): BrewfatherImport["recipes"][number]["draft"] {
  const beverage = z.enum(["beer", "mead", "wine", "cider"]).safeParse(term(raw.beverage));
  return {
    name: requiredText(raw.name),
    batchSizeL: z.number().positive().max(100_000).parse(raw.batchSize),
    beverage: beverage.data ?? "beer",
    credit: credit(raw),
    visibility: "private",
    content: {
      schemaVersion: 1,
      efficiencyPct: num(raw.efficiency, 0.01, 100),
      boilTimeMin: num(raw.boilTime, 0, 10_000),
      fermentables: entries(raw.fermentables).map((row) => ({
        name: requiredText(row.name),
        kind: lookup(fermentableKind, row.type) ?? "other",
        use: lookup(fermentableUse, row.use),
        amountKg: z.number().positive().parse(row.amount),
        potentialSg: num(row.potential, 0.98, 1.3),
        colorEbc: ebc(row.color, 5_000),
        dayOffset: ["days", "day"].includes(term(row.timeUnit) ?? "")
          ? num(row.time, 0, 3650)
          : undefined,
        note: text(row.notes, 2_000),
      })),
      hops: entries(raw.hops).map((row) => {
        const use = lookup(hopUse, row.use) ?? "boil";
        const inMinutes = term(row.timeUnit) === "min";
        const time = num(row.time, 0, 10_000);
        return {
          name: requiredText(row.name),
          use,
          form: lookup(hopForm, row.type),
          amountKg: units.massToKg(z.number().positive().parse(row.amount), "g"),
          alphaAcidPct: num(row.alpha, 0, 100),
          timeMin: use === "boil" ? (time ?? 0) : use === "whirlpool" ? time : undefined,
          tempC: num(row.temp, -10, 110),
          days:
            use === "dry_hop" && time !== undefined
              ? num(inMinutes ? units.minutesToDays(time) : time, 0, 3650)
              : undefined,
          note: text(row.notes, 2_000),
        };
      }),
      yeasts: entries(raw.yeasts).map((row) => {
        const amount = num(row.amount, 0.000001);
        const q = amount === undefined ? undefined : quantity(row.unit, amount);
        const form = z.enum(["dry", "liquid", "slurry", "culture"]).safeParse(term(row.form));
        const cells = term(row.unit) === "billion cells";
        return {
          name: requiredText(row.name),
          form: form.data,
          attenuationPct: num(row.attenuation, 0, 100),
          amountKg: q?.unit === "kg" ? q.value : undefined,
          amountL: q?.unit === "l" ? q.value : undefined,
          packs: q?.unit === "each" && !cells ? q.value : undefined,
          note: text(
            [cells && amount !== undefined ? `${amount} billion cells` : null, text(row.notes)]
              .filter(Boolean)
              .join(". "),
            2_000,
          ),
        };
      }),
      miscs: entries(raw.miscs).map((row) => {
        const q = quantity(row.unit, z.number().positive().parse(row.amount));
        const inDays = ["days", "day"].includes(term(row.timeUnit) ?? "");
        return {
          name: requiredText(row.name),
          kind: lookup(miscKind, row.type) ?? "other",
          use: lookup(miscUse, row.use) ?? "boil",
          amountKg: q.unit === "kg" ? q.value : undefined,
          amountL: q.unit === "l" ? q.value : undefined,
          count: q.unit === "each" ? q.value : undefined,
          timeMin: inDays ? undefined : num(row.time, 0, 10_000),
          dayOffset: inDays ? num(row.time, 0, 3650) : undefined,
          note: text(row.notes, 2_000),
        };
      }),
      mash: profile(raw.mash).map((step) => ({
        name: requiredText(step.name),
        type:
          z.enum(["infusion", "temperature", "decoction"]).safeParse(term(step.type)).data ??
          "temperature",
        tempC: z.number().parse(step.stepTemp),
        timeMin: z.number().nonnegative().parse(step.stepTime),
        infuseL: num(step.infuseAmount, 0.000001, 100_000),
      })),
      fermentation: profile(raw.fermentation).map((step) => ({
        name: requiredText(step.name),
        stage: lookup(fermentationStage, step.type) ?? "other",
        tempC: num(step.stepTemp, -10, 110),
        days: num(step.stepTime, 0, 3_650),
      })),
      targets: {
        og: num(raw.og, 0.98, 1.3),
        fg: num(raw.fg, 0.98, 1.3),
        abvPct: num(raw.abv, 0, 30),
        ibu: num(raw.ibu, 0, 300),
        colorEbc: ebc(raw.color, 1_000),
        carbonationVols: num(raw.carbonation, 0, 6),
      },
      notes: text(raw.notes, 20_000),
    },
  };
}

export const inventoryKinds = ["fermentables", "hops", "yeasts", "miscs"] as const;
type Kind = (typeof inventoryKinds)[number];

export function brewfatherStock(row: Entry, kind: Kind): BrewfatherImport["inventory"][number][] {
  const stock = num(row.inventory, 0.000001);
  if (stock === undefined) return [];
  const q = quantity(kind === "fermentables" ? "kg" : kind === "hops" ? "g" : row.unit, stock);
  const unit = term(row.unit);
  const notes = [
    unit === "billion cells" || unit === "drops" ? `Brewfather stock unit: ${unit}` : null,
    text(row.notes, 2_000),
  ]
    .filter(Boolean)
    .join("\n");
  return [
    {
      name: requiredText(row.name),
      quantity: q.value,
      quantityUnit: q.unit,
      alphaAcidPct: kind === "hops" ? num(row.alpha, 0, 100) : undefined,
      notes: text(notes, 2_000),
    },
  ];
}

const batchStatus = {
  planning: "planned",
  brewing: "brewing",
  fermenting: "fermenting",
  conditioning: "conditioning",
  completed: "finished",
  archived: "finished",
} as const;

export function brewfatherBatch(
  row: Entry,
  recipeRef: string,
  readings: Entry[],
): BrewfatherImport["batches"][number] {
  const status = lookup(batchStatus, row.status) ?? "planned";
  return {
    recipeRef,
    name: text(row.name),
    status,
    batchSizeL: num(row.measuredBatchSize, 0.000001, 100_000),
    brewedAt: status === "planned" ? undefined : brewfatherDate(row.brewDate),
    completedAt: status === "finished" ? brewfatherDate(row.bottlingDate) : undefined,
    readings: readings.flatMap((reading) => {
      const parsed = ReadingInput.safeParse({
        takenAt: brewfatherDate(reading.time),
        gravitySg: num(reading.sg, 0.98, 1.3),
        temperatureC: num(reading.temp, -10, 110),
        source: reading.type && term(reading.type) !== "manual" ? "device" : "manual",
        note: text(reading.comment, 2_000),
      });
      return parsed.success ? [parsed.data] : [];
    }),
  };
}
