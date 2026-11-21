// SPDX-License-Identifier: AGPL-3.0-or-later
// Alcohol, attenuation and calories from original and final gravity.
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { sgToPlato } from "./units.ts";

function checkGravities(og: number, fg: number): string | null {
  return (
    outside("Original gravity", og, 1.0, 1.2) ??
    outside("Final gravity", fg, 0.98, 1.2) ??
    (fg > og ? "Final gravity can't be higher than original gravity" : null)
  );
}

/** ABV % — standard homebrew formula: (OG − FG) × 131.25. Good below about 8% ABV. */
export function abvStandard(og: number, fg: number): CalcResult<number> {
  const err = checkGravities(og, fg);
  return err ? fail(err) : ok((og - fg) * 131.25);
}

/**
 * ABV % — alternate formula, more accurate for strong beers, meads and wines:
 * (76.08 × (OG − FG) / (1.775 − OG)) × (FG / 0.794).
 */
export function abvAlternate(og: number, fg: number): CalcResult<number> {
  const err = checkGravities(og, fg);
  return err ? fail(err) : ok(((76.08 * (og - fg)) / (1.775 - og)) * (fg / 0.794));
}

/** Apparent attenuation %: (OG − FG) / (OG − 1) × 100. */
export function apparentAttenuation(og: number, fg: number): CalcResult<number> {
  const err = checkGravities(og, fg) ?? (og <= 1 ? "Original gravity must be above 1.000" : null);
  return err ? fail(err) : ok(((og - fg) / (og - 1)) * 100);
}

/**
 * Real attenuation % (Balling): real extract RE = 0.1808 × OE + 0.8192 × AE (°P),
 * real attenuation = (OE − RE) / OE × 100.
 */
export function realAttenuation(og: number, fg: number): CalcResult<number> {
  const err = checkGravities(og, fg) ?? (og <= 1 ? "Original gravity must be above 1.000" : null);
  if (err) return fail(err);
  const oe = sgToPlato(og);
  const ae = sgToPlato(fg);
  const re = 0.1808 * oe + 0.8192 * ae;
  return ok(((oe - re) / oe) * 100);
}

/**
 * Calories in 12 US fl oz (355 mL): alcohol 1881.22 × FG × (OG − FG) / (1.775 − OG)
 * plus carbohydrate 3550 × FG × (0.1808 × OG + 0.8192 × FG − 1.0004).
 */
export function caloriesPer355ml(og: number, fg: number): CalcResult<number> {
  const err = checkGravities(og, fg);
  if (err) return fail(err);
  const alcohol = (1881.22 * fg * (og - fg)) / (1.775 - og);
  const carbs = 3550 * fg * (0.1808 * og + 0.8192 * fg - 1.0004);
  return ok(alcohol + Math.max(carbs, 0));
}
