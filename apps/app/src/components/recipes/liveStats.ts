// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  type Fermentable,
  type Fit,
  type HopAddition,
  type RecipeStats,
  recipeStats,
  type StyleRanges,
  styleFit,
  units,
} from "@brew-bruvs/brew-math";
import type {
  Beverage,
  EquipmentProfile,
  RecipeContent,
  RecipeVersion,
  RecipeVersionInput,
} from "../../api/recipes";
import type { UnitSystem } from "../../state/units";
import { convertText, formatFixed, parseNumber } from "../calculators/parseNumber";

export type FermentableKind = RecipeContent["fermentables"][number]["kind"];
export type FermentableUse = NonNullable<RecipeContent["fermentables"][number]["use"]>;
export type HopUse = RecipeContent["hops"][number]["use"];
export type YeastForm = NonNullable<RecipeContent["yeasts"][number]["form"]>;
export type MiscKind = RecipeContent["miscs"][number]["kind"];
export type MiscUse = RecipeContent["miscs"][number]["use"];
export type MashStepType = RecipeContent["mash"][number]["type"];
export type FermentationStage = RecipeContent["fermentation"][number]["stage"];

export interface DraftFermentable {
  key: string;
  name: string;
  catalogId?: string;
  kind: FermentableKind;
  measure: "weight" | "volume";
  amountText: string;
  use: FermentableUse;
  potentialSgText: string;
  colorText: string; // °L in US, EBC in Metric
  dayOffsetText: string;
}

export interface DraftHop {
  key: string;
  name: string;
  catalogId?: string;
  amountText: string; // oz in US, g in Metric
  alphaAcidText: string;
  use: HopUse;
  timeMinText: string;
  daysText: string;
}

export interface DraftYeast {
  key: string;
  name: string;
  catalogId?: string;
  form: YeastForm;
  packsText: string;
  attenuationText: string;
}

export interface DraftMisc {
  key: string;
  name: string;
  catalogId?: string;
  kind: MiscKind;
  amountMode: "mass" | "volume" | "count";
  amountText: string; // g in metric / oz in US for mass; L/gal for volume; count for count
  use: MiscUse;
  timeMinText: string;
  dayOffsetText: string;
}

export interface DraftMashStep {
  key: string;
  name: string;
  type: MashStepType;
  tempText: string; // °F in US, °C in Metric
  timeMinText: string;
  infuseText: string; // US gal in US, L in Metric
}

export interface DraftFermentationStep {
  key: string;
  name: string;
  stage: FermentationStage;
  tempText: string;
  daysText: string;
}

export interface RecipeDraft {
  name: string;
  beverage: Beverage;
  styleId: string | null;
  equipmentProfileId: string | null;
  batchSizeText: string; // US gal in US, L in Metric
  efficiencyText: string;
  boilTimeText: string;
  fermentables: DraftFermentable[];
  hops: DraftHop[];
  yeasts: DraftYeast[];
  miscs: DraftMisc[];
  mash: DraftMashStep[];
  fermentation: DraftFermentationStep[];
  notes: string;
}

let nextKeyCounter = 1;
export function newLineKey(prefix: string): string {
  nextKeyCounter += 1;
  return `${prefix}-${nextKeyCounter}`;
}

export function createBlankDraft(unitSystem: UnitSystem, beverage: Beverage = "beer"): RecipeDraft {
  return {
    name: "",
    beverage,
    styleId: null,
    equipmentProfileId: null,
    batchSizeText: unitSystem === "us" ? "5.0" : "18.9",
    efficiencyText: beverage === "beer" ? "72" : "100",
    boilTimeText: beverage === "beer" ? "60" : "0",
    fermentables: [],
    hops: [],
    yeasts: [],
    miscs: [],
    mash:
      beverage === "beer"
        ? [
            {
              key: newLineKey("mash"),
              name: "Saccharification",
              type: "infusion",
              tempText: unitSystem === "us" ? "152" : "66.7",
              timeMinText: "60",
              infuseText: "",
            },
          ]
        : [],
    fermentation: [
      {
        key: newLineKey("ferm-step"),
        name: "Primary Fermentation",
        stage: "primary",
        tempText: unitSystem === "us" ? "68" : "20.0",
        daysText: "14",
      },
    ],
    notes: "",
  };
}

export function draftFromVersion(version: RecipeVersion, unitSystem: UnitSystem): RecipeDraft {
  const c = version.content;
  const volOut = (l: number) =>
    unitSystem === "us" ? formatFixed(units.litersToGallons(l), 2) : formatFixed(l, 2);
  const weightOut = (kg: number) =>
    unitSystem === "us" ? formatFixed(units.kgToLb(kg), 2) : formatFixed(kg, 3);
  const hopOut = (kg: number) =>
    unitSystem === "us" ? formatFixed(units.gToOz(kg * 1000), 2) : formatFixed(kg * 1000, 1);
  const tempOut = (tC: number) =>
    unitSystem === "us" ? formatFixed(units.cToF(tC), 1) : formatFixed(tC, 1);
  const colorOut = (ebc: number) =>
    unitSystem === "us"
      ? formatFixed(units.srmToLovibond(units.ebcToSrm(ebc)), 1)
      : formatFixed(ebc, 1);

  return {
    name: version.name,
    beverage: version.beverage,
    styleId: version.styleId,
    equipmentProfileId: version.equipmentProfileId,
    batchSizeText: volOut(version.batchSizeL),
    efficiencyText: c.efficiencyPct !== undefined ? String(c.efficiencyPct) : "72",
    boilTimeText: c.boilTimeMin !== undefined ? String(c.boilTimeMin) : "60",
    fermentables: c.fermentables.map((f) => ({
      key: newLineKey("ferm"),
      name: f.name,
      ...(f.catalogId ? { catalogId: f.catalogId } : {}),
      kind: f.kind,
      measure: f.amountL !== undefined ? "volume" : "weight",
      amountText:
        f.amountL !== undefined
          ? volOut(f.amountL)
          : f.amountKg !== undefined
            ? weightOut(f.amountKg)
            : "",
      use: f.use ?? (f.kind === "grain" || f.kind === "adjunct" ? "mash" : "fermentation"),
      potentialSgText:
        f.potentialSg !== undefined ? formatFixed(f.potentialSg, 4).replace(/0$/, "") : "",
      colorText: f.colorEbc !== undefined ? colorOut(f.colorEbc) : "",
      dayOffsetText: f.dayOffset !== undefined ? String(f.dayOffset) : "",
    })),
    hops: c.hops.map((h) => ({
      key: newLineKey("hop"),
      name: h.name,
      ...(h.catalogId ? { catalogId: h.catalogId } : {}),
      amountText: hopOut(h.amountKg),
      alphaAcidText: h.alphaAcidPct !== undefined ? String(h.alphaAcidPct) : "",
      use: h.use,
      timeMinText: h.timeMin !== undefined ? String(h.timeMin) : "",
      daysText: h.days !== undefined ? String(h.days) : "",
    })),
    yeasts: c.yeasts.map((y) => ({
      key: newLineKey("yeast"),
      name: y.name,
      ...(y.catalogId ? { catalogId: y.catalogId } : {}),
      form: y.form ?? "dry",
      packsText: y.packs !== undefined ? String(y.packs) : "1",
      attenuationText: y.attenuationPct !== undefined ? String(y.attenuationPct) : "",
    })),
    miscs: c.miscs.map((m) => ({
      key: newLineKey("misc"),
      name: m.name,
      ...(m.catalogId ? { catalogId: m.catalogId } : {}),
      kind: m.kind,
      amountMode: m.count !== undefined ? "count" : m.amountL !== undefined ? "volume" : "mass",
      amountText:
        m.count !== undefined
          ? String(m.count)
          : m.amountL !== undefined
            ? volOut(m.amountL)
            : m.amountKg !== undefined
              ? hopOut(m.amountKg)
              : "",
      use: m.use,
      timeMinText: m.timeMin !== undefined ? String(m.timeMin) : "",
      dayOffsetText: m.dayOffset !== undefined ? String(m.dayOffset) : "",
    })),
    mash: c.mash.map((s) => ({
      key: newLineKey("mash"),
      name: s.name,
      type: s.type,
      tempText: tempOut(s.tempC),
      timeMinText: String(s.timeMin),
      infuseText: s.infuseL !== undefined ? volOut(s.infuseL) : "",
    })),
    fermentation: c.fermentation.map((s) => ({
      key: newLineKey("ferm-step"),
      name: s.name,
      stage: s.stage,
      tempText: s.tempC !== undefined ? tempOut(s.tempC) : "",
      daysText: s.days !== undefined ? String(s.days) : "",
    })),
    notes: c.notes ?? "",
  };
}

export function convertDraftUnits(draft: RecipeDraft, next: UnitSystem): RecipeDraft {
  const convVol = (v: string) =>
    convertText(v, next === "us" ? units.litersToGallons : units.gallonsToLiters, 2);
  const convMass = (v: string) =>
    convertText(v, next === "us" ? units.kgToLb : units.lbToKg, next === "us" ? 2 : 3);
  const convSmall = (v: string) =>
    convertText(v, next === "us" ? units.gToOz : units.ozToG, next === "us" ? 2 : 1);
  const convTemp = (v: string) => convertText(v, next === "us" ? units.cToF : units.fToC, 1);
  const convColor = (v: string) =>
    convertText(
      v,
      next === "us"
        ? (ebc) => units.srmToLovibond(units.ebcToSrm(ebc))
        : (lov) => units.srmToEbc(units.lovibondToSrm(lov)),
      1,
    );

  return {
    ...draft,
    batchSizeText: convVol(draft.batchSizeText),
    fermentables: draft.fermentables.map((f) => ({
      ...f,
      amountText: f.measure === "volume" ? convVol(f.amountText) : convMass(f.amountText),
      colorText: convColor(f.colorText),
    })),
    hops: draft.hops.map((h) => ({ ...h, amountText: convSmall(h.amountText) })),
    miscs: draft.miscs.map((m) => ({
      ...m,
      amountText:
        m.amountMode === "mass"
          ? convSmall(m.amountText)
          : m.amountMode === "volume"
            ? convVol(m.amountText)
            : m.amountText,
    })),
    mash: draft.mash.map((s) => ({
      ...s,
      tempText: convTemp(s.tempText),
      infuseText: convVol(s.infuseText),
    })),
    fermentation: draft.fermentation.map((s) => ({
      ...s,
      tempText: convTemp(s.tempText),
    })),
  };
}

export type VersionBuildResult =
  | { ok: true; input: RecipeVersionInput }
  | { ok: false; error: string };

export function draftToVersionInput(
  draft: RecipeDraft,
  unitSystem: UnitSystem,
): VersionBuildResult {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Enter a recipe name." };

  const batchVal = parseNumber(draft.batchSizeText);
  if (batchVal === null || batchVal <= 0) {
    return { ok: false, error: "Enter a positive batch size." };
  }
  const batchSizeL = unitSystem === "us" ? units.gallonsToLiters(batchVal) : batchVal;

  const effVal = parseNumber(draft.efficiencyText);
  if (draft.efficiencyText.trim() && (effVal === null || effVal <= 0 || effVal > 100)) {
    return { ok: false, error: "Efficiency must be between 1% and 100%." };
  }

  const boilVal = parseNumber(draft.boilTimeText);
  if (draft.boilTimeText.trim() && (boilVal === null || boilVal < 0)) {
    return { ok: false, error: "Boil time must be 0 or more minutes." };
  }

  const fermentables: RecipeContent["fermentables"] = [];
  for (const f of draft.fermentables) {
    const fName = f.name.trim();
    const amt = parseNumber(f.amountText);
    if (!fName || amt === null || amt <= 0) {
      return {
        ok: false,
        error: `Check fermentable "${fName || "Unnamed"}": name and positive amount are required.`,
      };
    }
    const potentialSg = parseNumber(f.potentialSgText);
    const colorRaw = parseNumber(f.colorText);
    const colorEbc =
      colorRaw === null
        ? undefined
        : unitSystem === "us"
          ? Math.max(0, units.srmToEbc(units.lovibondToSrm(colorRaw)))
          : Math.max(0, colorRaw);
    const dayOffset = parseNumber(f.dayOffsetText);

    fermentables.push({
      name: fName,
      ...(f.catalogId ? { catalogId: f.catalogId } : {}),
      kind: f.kind,
      ...(f.measure === "volume"
        ? { amountL: unitSystem === "us" ? units.gallonsToLiters(amt) : amt }
        : { amountKg: unitSystem === "us" ? units.lbToKg(amt) : amt }),
      use: f.use,
      ...(potentialSg !== null ? { potentialSg } : {}),
      ...(colorEbc !== undefined ? { colorEbc } : {}),
      ...(dayOffset !== null ? { dayOffset } : {}),
    });
  }

  const hops: RecipeContent["hops"] = [];
  for (const h of draft.hops) {
    const hName = h.name.trim();
    const amt = parseNumber(h.amountText);
    if (!hName || amt === null || amt <= 0) {
      return {
        ok: false,
        error: `Check hop "${hName || "Unnamed"}": name and positive amount are required.`,
      };
    }
    const amountKg = (unitSystem === "us" ? units.ozToG(amt) : amt) / 1000;
    const alphaAcidPct = parseNumber(h.alphaAcidText);
    const timeMin = parseNumber(h.timeMinText);
    const days = parseNumber(h.daysText);
    if (h.use === "boil" && timeMin === null) {
      return { ok: false, error: `Boil hop "${hName}" needs a boil time in minutes.` };
    }
    hops.push({
      name: hName,
      ...(h.catalogId ? { catalogId: h.catalogId } : {}),
      amountKg,
      ...(alphaAcidPct !== null ? { alphaAcidPct } : {}),
      use: h.use,
      ...(timeMin !== null ? { timeMin } : {}),
      ...(days !== null ? { days } : {}),
    });
  }

  const yeasts: RecipeContent["yeasts"] = [];
  for (const y of draft.yeasts) {
    const yName = y.name.trim();
    if (!yName) {
      return { ok: false, error: "Every yeast line needs a name." };
    }
    const packs = parseNumber(y.packsText);
    const attenuationPct = parseNumber(y.attenuationText);
    yeasts.push({
      name: yName,
      ...(y.catalogId ? { catalogId: y.catalogId } : {}),
      form: y.form,
      ...(packs !== null && packs > 0 ? { packs } : {}),
      ...(attenuationPct !== null ? { attenuationPct } : {}),
    });
  }

  const miscs: RecipeContent["miscs"] = [];
  for (const m of draft.miscs) {
    const mName = m.name.trim();
    const amt = parseNumber(m.amountText);
    if (!mName || amt === null || amt <= 0) {
      return {
        ok: false,
        error: `Check addition "${mName || "Unnamed"}": name and positive amount are required.`,
      };
    }
    const timeMin = parseNumber(m.timeMinText);
    const dayOffset = parseNumber(m.dayOffsetText);
    miscs.push({
      name: mName,
      ...(m.catalogId ? { catalogId: m.catalogId } : {}),
      kind: m.kind,
      ...(m.amountMode === "count"
        ? { count: amt }
        : m.amountMode === "volume"
          ? { amountL: unitSystem === "us" ? units.gallonsToLiters(amt) : amt }
          : { amountKg: (unitSystem === "us" ? units.ozToG(amt) : amt) / 1000 }),
      use: m.use,
      ...(timeMin !== null ? { timeMin } : {}),
      ...(dayOffset !== null ? { dayOffset } : {}),
    });
  }

  const mash: RecipeContent["mash"] = [];
  for (const s of draft.mash) {
    const sName = s.name.trim();
    const tempVal = parseNumber(s.tempText);
    const timeVal = parseNumber(s.timeMinText);
    if (!sName || tempVal === null || timeVal === null) {
      return {
        ok: false,
        error: `Check mash step "${sName || "Unnamed"}": name, temp, and time are required.`,
      };
    }
    const infuseVal = parseNumber(s.infuseText);
    mash.push({
      name: sName,
      type: s.type,
      tempC: unitSystem === "us" ? units.fToC(tempVal) : tempVal,
      timeMin: timeVal,
      ...(infuseVal !== null && infuseVal > 0
        ? { infuseL: unitSystem === "us" ? units.gallonsToLiters(infuseVal) : infuseVal }
        : {}),
    });
  }

  const fermentation: RecipeContent["fermentation"] = [];
  for (const s of draft.fermentation) {
    const sName = s.name.trim();
    if (!sName) {
      return { ok: false, error: "Every fermentation/aging step needs a name." };
    }
    const tempVal = parseNumber(s.tempText);
    const daysVal = parseNumber(s.daysText);
    fermentation.push({
      name: sName,
      stage: s.stage,
      ...(tempVal !== null ? { tempC: unitSystem === "us" ? units.fToC(tempVal) : tempVal } : {}),
      ...(daysVal !== null ? { days: daysVal } : {}),
    });
  }

  const trimmedNotes = draft.notes.trim();
  return {
    ok: true,
    input: {
      name,
      styleId: draft.styleId,
      batchSizeL,
      equipmentProfileId: draft.equipmentProfileId,
      content: {
        schemaVersion: 1,
        ...(effVal !== null ? { efficiencyPct: effVal } : {}),
        ...(boilVal !== null ? { boilTimeMin: boilVal } : {}),
        fermentables,
        hops,
        yeasts,
        miscs,
        mash,
        fermentation,
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      },
    },
  };
}

export interface LiveStatsResult {
  stats: RecipeStats | null;
  error: string | null;
  fit: Record<"og" | "fg" | "abvPct" | "ibu" | "colorEbc", Fit> | null;
}

const DEFAULT_EFFICIENCY_PCT = 72;

export function computeLiveRecipeStats(
  draft: RecipeDraft,
  unitSystem: UnitSystem,
  style: StyleRanges | null,
  equipment: EquipmentProfile | null,
): LiveStatsResult {
  const batchVal = parseNumber(draft.batchSizeText);
  if (batchVal === null || batchVal <= 0) {
    return { stats: null, error: "Enter a batch size to estimate stats.", fit: null };
  }
  const volumeL = unitSystem === "us" ? units.gallonsToLiters(batchVal) : batchVal;
  const effVal =
    parseNumber(draft.efficiencyText) ?? equipment?.efficiencyPct ?? DEFAULT_EFFICIENCY_PCT;

  const fermentables: Fermentable[] = [];
  for (const f of draft.fermentables) {
    if (f.use === "package") continue;
    const amt = parseNumber(f.amountText);
    const potentialSg = parseNumber(f.potentialSgText);
    if (amt === null || amt <= 0) continue;
    if (potentialSg === null) {
      return { stats: null, error: `${f.name || "Fermentable"} needs a potential SG.`, fit: null };
    }
    if (f.measure === "volume") {
      fermentables.push({
        liters: unitSystem === "us" ? units.gallonsToLiters(amt) : amt,
        sg: potentialSg,
      });
    } else {
      const colorRaw = parseNumber(f.colorText);
      const colorEbc =
        colorRaw === null
          ? undefined
          : unitSystem === "us"
            ? Math.max(0, units.srmToEbc(units.lovibondToSrm(colorRaw)))
            : Math.max(0, colorRaw);
      const mashed = f.use === "mash" || f.use === "steep";
      fermentables.push({
        kg: unitSystem === "us" ? units.lbToKg(amt) : amt,
        potentialSg,
        mashed,
        ...(colorEbc !== undefined ? { colorEbc } : {}),
      });
    }
  }

  if (fermentables.length === 0) {
    return {
      stats: null,
      error: "Add a fermentable to calculate OG, FG, ABV, and color.",
      fit: null,
    };
  }

  const hops: HopAddition[] = [];
  for (const h of draft.hops) {
    if (h.use !== "boil") continue;
    const amt = parseNumber(h.amountText);
    const aa = parseNumber(h.alphaAcidText);
    const mins = parseNumber(h.timeMinText);
    if (amt === null || amt <= 0) continue;
    if (aa === null || mins === null) {
      return {
        stats: null,
        error: `Boil hop "${h.name || "Hop"}" needs AA% and boil minutes.`,
        fit: null,
      };
    }
    hops.push({
      alphaAcidPct: aa,
      hopGrams: unitSystem === "us" ? units.ozToG(amt) : amt,
      minutes: mins,
    });
  }

  const attenuationPct = draft.yeasts
    .map((y) => parseNumber(y.attenuationText))
    .find((v): v is number => v !== null);
  if (attenuationPct === undefined) {
    return {
      stats: null,
      error: "Add a yeast with attenuation % to estimate FG and ABV.",
      fit: null,
    };
  }

  const result = recipeStats({
    volumeL,
    efficiencyPct: effVal,
    fermentables,
    attenuationPct,
    hops,
    ...(equipment?.boilSizeL != null && equipment.boilSizeL >= volumeL
      ? { boilVolumeL: equipment.boilSizeL }
      : {}),
  });

  if (!result.ok) {
    return { stats: null, error: result.error.message, fit: null };
  }

  return {
    stats: result.value,
    error: null,
    fit: style ? styleFit(result.value, style) : null,
  };
}
