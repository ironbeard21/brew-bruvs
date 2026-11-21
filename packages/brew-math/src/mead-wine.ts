// SPDX-License-Identifier: AGPL-3.0-or-later
// Mead, wine and cider calculations.
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { lbToKg, litersToGallons, sgToBrix } from "./units.ts";

/** Gravity points per pound per US gallon. Honey varies with moisture; treat as a setting. */
export const HONEY_PPG = 35;
export const SUCROSE_PPG = 46;

/**
 * Kilograms of honey or sugar to raise `volumeL` from `currentSg` to `targetSg`:
 * pounds = (target − current) × 1000 × gallons / ppg. Use for building a must,
 * chaptalization and backsweetening (start from water at 1.000 for a new must).
 */
export function sugarToRaiseGravity(input: {
  volumeL: number;
  currentSg: number;
  targetSg: number;
  pointsPerPoundPerGallon: number;
}): CalcResult<number> {
  const { volumeL, currentSg, targetSg, pointsPerPoundPerGallon } = input;
  const err =
    outside("Volume", volumeL, 0.1, 100000) ??
    outside("Current gravity", currentSg, 0.98, 1.2) ??
    outside("Target gravity", targetSg, 0.98, 1.2) ??
    outside("Points per pound per gallon", pointsPerPoundPerGallon, 10, 50) ??
    (targetSg < currentSg ? "Target gravity must be at least the current gravity" : null);
  if (err) return fail(err);
  const pounds = ((targetSg - currentSg) * 1000 * litersToGallons(volumeL)) / pointsPerPoundPerGallon;
  return ok(lbToKg(pounds));
}

/** Nitrogen need of a yeast strain, as listed by the producer. */
export const NITROGEN_NEED_FACTOR = { low: 0.75, medium: 0.9, high: 1.25 } as const;
export type NitrogenNeed = keyof typeof NITROGEN_NEED_FACTOR;

/**
 * Target yeast assimilable nitrogen (YAN, mg/L): sugar (g/L) × factor, with sugar ≈ Brix × 10
 * (Scott Laboratories Winemaking Handbook).
 */
export function yanTarget(og: number, need: NitrogenNeed): CalcResult<number> {
  const err = outside("Original gravity", og, 1.001, 1.2);
  return err ? fail(err) : ok(sgToBrix(og) * 10 * NITROGEN_NEED_FACTOR[need]);
}

/** Nitrogen fraction of common inorganic nutrients (WineMaker, "Managing Nutrition of Juice and Wine"). */
export const NUTRIENT_NITROGEN_FRACTION = { dap: 0.21, "fermaid-k": 0.13 } as const;

/**
 * Nutrient plan: grams of nutrient to cover the YAN shortfall, split in half: one dose
 * 12–24 hours after pitching and one at 1/3 sugar depletion (Oregon State University
 * extension guidance). Also returns the gravity at which 1/3 of the sugar is gone.
 */
export function nutrientPlan(input: {
  volumeL: number;
  og: number;
  expectedFg: number;
  need: NitrogenNeed;
  /** YAN already in the must, mg/L (honey musts are close to 0). */
  measuredYan?: number;
  /** Mass fraction of nitrogen in the nutrient, e.g. NUTRIENT_NITROGEN_FRACTION.dap. */
  nitrogenFraction: number;
}): CalcResult<{
  yanTarget: number;
  shortfall: number;
  totalGrams: number;
  doses: { when: "24h-after-pitch" | "one-third-sugar-break"; grams: number }[];
  oneThirdBreakSg: number;
}> {
  const { volumeL, og, expectedFg, need, measuredYan = 0, nitrogenFraction } = input;
  const target = yanTarget(og, need);
  if (!target.ok) return target;
  const err =
    outside("Volume", volumeL, 0.1, 100000) ??
    outside("Expected final gravity", expectedFg, 0.98, og) ??
    outside("Measured YAN", measuredYan, 0, 1000) ??
    outside("Nitrogen fraction", nitrogenFraction, 0.01, 1);
  if (err) return fail(err);
  const shortfall = Math.max(target.value - measuredYan, 0);
  const totalGrams = (shortfall * volumeL) / (nitrogenFraction * 1000);
  return ok({
    yanTarget: target.value,
    shortfall,
    totalGrams,
    doses: [
      { when: "24h-after-pitch", grams: totalGrams / 2 },
      { when: "one-third-sugar-break", grams: totalGrams / 2 },
    ],
    oneThirdBreakSg: og - (og - expectedFg) / 3,
  });
}

/**
 * Free SO2 (mg/L) needed for a target molecular SO2 at a given pH:
 * free = molecular × (1 + 10^(pH − 1.81)). Common targets: 0.8 mg/L whites, meads and ciders;
 * 0.5 mg/L reds.
 */
export function freeSo2Needed(ph: number, molecularMgL = 0.8): CalcResult<number> {
  const err = outside("pH", ph, 2.8, 4.2) ?? outside("Molecular SO2", molecularMgL, 0.1, 2);
  return err ? fail(err) : ok(molecularMgL * (1 + 10 ** (ph - 1.81)));
}

/** Grams of potassium metabisulfite to raise free SO2 by `ppm` (it yields 57.6% SO2 by weight). */
export function potassiumMetabisulfite(ppm: number, volumeL: number): CalcResult<number> {
  const err = outside("SO2 increase", ppm, 0, 300) ?? outside("Volume", volumeL, 0.1, 100000);
  return err ? fail(err) : ok((ppm * volumeL) / 576);
}

/** Grams of each acid equivalent to 1 g of tartaric acid in titratable acidity (by equivalent weight). */
export const ACID_EQUIVALENT = { tartaric: 1, malic: 67.05 / 75.04, citric: 64.04 / 75.04 } as const;
export type Acid = keyof typeof ACID_EQUIVALENT;

/** Grams of acid to raise titratable acidity (expressed as tartaric, g/L) to the target. */
export function acidAddition(input: {
  volumeL: number;
  currentTa: number;
  targetTa: number;
  acid: Acid;
}): CalcResult<number> {
  const { volumeL, currentTa, targetTa, acid } = input;
  const err =
    outside("Volume", volumeL, 0.1, 100000) ??
    outside("Current TA", currentTa, 0, 20) ??
    outside("Target TA", targetTa, 0, 20) ??
    (targetTa < currentTa ? "Target TA must be at least the current TA" : null);
  if (err) return fail(err);
  return ok((targetTa - currentTa) * volumeL * ACID_EQUIVALENT[acid]);
}

export interface Lot {
  volumeL: number;
  abv?: number;
  sg?: number;
  ta?: number;
}

/** Volume-weighted blend of lots. A property is returned only when every lot has it. */
export function blend(lots: Lot[]): CalcResult<Lot> {
  if (lots.length < 2) return fail("A blend needs at least two lots", "invalid_input");
  const err = lots.map((l) => outside("Lot volume", l.volumeL, 0.01, 100000)).find((e) => e !== null);
  if (err) return fail(err);
  const volumeL = lots.reduce((s, l) => s + l.volumeL, 0);
  const result: Lot = { volumeL };
  for (const key of ["abv", "sg", "ta"] as const) {
    if (lots.every((l) => l[key] !== undefined)) {
      result[key] = lots.reduce((s, l) => s + (l[key] as number) * l.volumeL, 0) / volumeL;
    }
  }
  return ok(result);
}
