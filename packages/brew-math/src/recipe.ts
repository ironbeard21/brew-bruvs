// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipe-level estimates: original and final gravity, ABV, bitterness and colour from a recipe's
// ingredients, and where the results sit against a style's ranges.
import { moreySrm } from "./color.ts";
import { abvAlternate, abvStandard } from "./gravity.ts";
import { type HopAddition, totalIbu } from "./ibu.ts";
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { ebcToSrm, kgToLb, litersToGallons, srmToEbc, srmToLovibond } from "./units.ts";

/** A sugar source measured by weight: grain, extract, sugar or honey. */
export interface SolidFermentable {
  kg: number;
  /** Potential as the SG of 1 lb in 1 US gallon (BeerXML convention), e.g. 1.037 for pale malt. */
  potentialSg: number;
  /** True for mashed or steeped grain, where efficiency applies. False for extract, sugar, honey. */
  mashed: boolean;
  /** Colour for the Morey estimate; omit for ingredients that add none. */
  colorEbc?: number;
}

/** A sugar source measured by volume: juice or must, at its own gravity. */
export interface LiquidFermentable {
  liters: number;
  sg: number;
}

export type Fermentable = SolidFermentable | LiquidFermentable;

const isLiquid = (f: Fermentable): f is LiquidFermentable => "liters" in f;

function checkFermentable(f: Fermentable): string | null {
  return isLiquid(f)
    ? (outside("Juice volume", f.liters, 0, 100000) ?? outside("Juice gravity", f.sg, 1.0, 1.2))
    : (outside("Fermentable weight", f.kg, 0, 10000) ??
        outside("Potential", f.potentialSg, 1.0, 1.06) ??
        (f.colorEbc === undefined ? null : outside("Colour", f.colorEbc, 0, 5000)));
}

/**
 * Estimated original gravity of `volumeL` (the volume into the fermenter):
 * points = Σ (potential − 1) × 1000 × pounds × efficiency / gallons for solids, efficiency 100%
 * unless mashed (Palmer, "How to Brew", extract potential and efficiency), plus
 * Σ (juice SG − 1) × 1000 × juice L / volume L for juices. OG = 1 + points / 1000.
 */
export function estimateOg(input: {
  volumeL: number;
  efficiencyPct: number;
  fermentables: Fermentable[];
}): CalcResult<number> {
  const { volumeL, efficiencyPct, fermentables } = input;
  const juiceL = fermentables.reduce((s, f) => s + (isLiquid(f) ? f.liters : 0), 0);
  const err =
    outside("Volume", volumeL, 0.1, 100000) ??
    outside("Efficiency", efficiencyPct, 1, 100) ??
    fermentables.map(checkFermentable).find((e) => e !== null) ??
    (juiceL > volumeL ? "Juice volume can't be more than the batch volume" : null);
  if (err) return fail(err);
  const gallons = litersToGallons(volumeL);
  const points = fermentables.reduce((sum, f) => {
    if (isLiquid(f)) return sum + ((f.sg - 1) * 1000 * f.liters) / volumeL;
    const efficiency = f.mashed ? efficiencyPct / 100 : 1;
    return sum + ((f.potentialSg - 1) * 1000 * kgToLb(f.kg) * efficiency) / gallons;
  }, 0);
  return ok(1 + points / 1000);
}

/**
 * Estimated final gravity from apparent attenuation: FG = 1 + (OG − 1) × (1 − attenuation / 100).
 * Attenuation above 100% gives FG below 1.000, as in dry wines and meads.
 */
export function estimateFg(og: number, attenuationPct: number): CalcResult<number> {
  const err =
    outside("Original gravity", og, 1.0, 1.2) ?? outside("Attenuation", attenuationPct, 0, 110);
  return err ? fail(err) : ok(1 + (og - 1) * (1 - attenuationPct / 100));
}

export interface RecipeStats {
  og: number;
  fg: number;
  abvPct: number;
  ibu: number;
  colorSrm: number;
  colorEbc: number;
}

/**
 * OG, FG, ABV, IBU and colour for a whole recipe, from the formulas above and:
 * ABV standard up to OG 1.070, alternate above (strong beers, meads, wines);
 * IBU at the average boil gravity 1 + (OG − 1) × volume / boil volume (Tinseth by default);
 * colour by Morey from the solid fermentables that have a colour.
 */
export function recipeStats(input: {
  volumeL: number;
  efficiencyPct: number;
  fermentables: Fermentable[];
  attenuationPct: number;
  /** Boil additions only; whirlpool and dry hops add no IBU in these models. */
  hops: HopAddition[];
  /** Volume during the boil; defaults to `volumeL`. */
  boilVolumeL?: number;
  ibuMethod?: "tinseth" | "rager";
}): CalcResult<RecipeStats> {
  const { volumeL, hops, boilVolumeL = input.volumeL, ibuMethod = "tinseth" } = input;
  const og = estimateOg(input);
  if (!og.ok) return og;
  const fg = estimateFg(og.value, input.attenuationPct);
  if (!fg.ok) return fg;
  const abv = (og.value > 1.07 ? abvAlternate : abvStandard)(og.value, fg.value);
  if (!abv.ok) return abv;

  const boilErr = outside("Boil volume", boilVolumeL, volumeL, 100000);
  if (boilErr) return fail(boilErr);
  const boilSg = 1 + ((og.value - 1) * volumeL) / boilVolumeL;
  const ibu = hops.length ? totalIbu(hops, { volumeL, boilSg }, ibuMethod) : ok(0);
  if (!ibu.ok) return ibu;

  const grains = input.fermentables.flatMap((f) =>
    isLiquid(f) || f.colorEbc === undefined
      ? []
      : [{ kg: f.kg, lovibond: srmToLovibond(ebcToSrm(f.colorEbc)) }],
  );
  const srm = grains.length ? moreySrm(grains, volumeL) : ok(0);
  if (!srm.ok) return srm;

  return ok({
    og: og.value,
    fg: fg.value,
    abvPct: abv.value,
    ibu: ibu.value,
    colorSrm: srm.value,
    colorEbc: srmToEbc(srm.value),
  });
}

/**
 * Factors for scaling a recipe to other equipment. Every amount scales with the volume ratio
 * (to / from); mashed and steeped grain also by old efficiency / new efficiency, so the same
 * gravity points come out of the mash (Palmer, "How to Brew", extract efficiency). Hops and
 * everything else scale with volume only, which keeps their concentration.
 */
export function scaleFactors(input: {
  fromVolumeL: number;
  toVolumeL: number;
  fromEfficiencyPct: number;
  toEfficiencyPct: number;
}): CalcResult<{ amounts: number; mashed: number }> {
  const { fromVolumeL, toVolumeL, fromEfficiencyPct, toEfficiencyPct } = input;
  const err =
    outside("Recipe volume", fromVolumeL, 0.1, 100000) ??
    outside("New volume", toVolumeL, 0.1, 100000) ??
    outside("Recipe efficiency", fromEfficiencyPct, 1, 100) ??
    outside("New efficiency", toEfficiencyPct, 1, 100);
  if (err) return fail(err);
  const amounts = toVolumeL / fromVolumeL;
  return ok({ amounts, mashed: (amounts * fromEfficiencyPct) / toEfficiencyPct });
}

/** Style ranges as the catalog stores them; a missing bound is null or omitted. */
export interface StyleRanges {
  ogMin?: number | null;
  ogMax?: number | null;
  fgMin?: number | null;
  fgMax?: number | null;
  abvMinPct?: number | null;
  abvMaxPct?: number | null;
  ibuMin?: number | null;
  ibuMax?: number | null;
  colorEbcMin?: number | null;
  colorEbcMax?: number | null;
}

export type Fit = "below" | "inside" | "above" | "unknown";

/**
 * Where each stat sits against a style's range, bounds included. "unknown" when the stat or both
 * bounds are missing; with one bound, only that side is checked.
 */
export function styleFit(
  stats: Partial<Pick<RecipeStats, "og" | "fg" | "abvPct" | "ibu" | "colorEbc">>,
  style: StyleRanges,
): Record<"og" | "fg" | "abvPct" | "ibu" | "colorEbc", Fit> {
  const fit = (value?: number, min?: number | null, max?: number | null): Fit => {
    if (value === undefined || (min == null && max == null)) return "unknown";
    if (min != null && value < min) return "below";
    if (max != null && value > max) return "above";
    return "inside";
  };
  return {
    og: fit(stats.og, style.ogMin, style.ogMax),
    fg: fit(stats.fg, style.fgMin, style.fgMax),
    abvPct: fit(stats.abvPct, style.abvMinPct, style.abvMaxPct),
    ibu: fit(stats.ibu, style.ibuMin, style.ibuMax),
    colorEbc: fit(stats.colorEbc, style.colorEbcMin, style.colorEbcMax),
  };
}
