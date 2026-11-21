// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { cToF, litersToGallons, psiToKpa } from "./units.ts";

/**
 * CO2 volumes already dissolved in beer after fermentation, from the warmest temperature
 * it reached: 3.0378 − 0.050062 × T + 0.00026555 × T² (T in °F).
 */
export function residualCo2(beerTempC: number): CalcResult<number> {
  const err = outside("Beer temperature", beerTempC, 0, 30);
  if (err) return fail(err);
  const t = cToF(beerTempC);
  return ok(3.0378 - 0.050062 * t + 0.00026555 * t ** 2);
}

/** Priming sugars, relative to corn sugar (dextrose). */
export const PRIMING_SUGARS = {
  "corn-sugar": 1,
  "table-sugar": 0.91,
} as const;
export type PrimingSugar = keyof typeof PRIMING_SUGARS;

/**
 * Grams of priming sugar for bottle conditioning: corn sugar g = 15.195 × V (US gal) ×
 * (target − residual CO2); table sugar about 9% less. Same formula as common homebrew
 * priming calculators.
 */
export function primingSugar(input: {
  volumeL: number;
  beerTempC: number;
  targetVolumes: number;
  sugar: PrimingSugar;
}): CalcResult<number> {
  const err =
    outside("Volume", input.volumeL, 0.1, 10000) ?? outside("Target CO2", input.targetVolumes, 1, 5);
  if (err) return fail(err);
  const residual = residualCo2(input.beerTempC);
  if (!residual.ok) return residual;
  const needed = input.targetVolumes - residual.value;
  if (needed <= 0) return fail("The beer already holds at least that much CO2");
  return ok(15.195 * litersToGallons(input.volumeL) * needed * PRIMING_SUGARS[input.sugar]);
}

/**
 * Regulator pressure (kPa, gauge) to force carbonate a keg to `targetVolumes` at a serving
 * temperature: P(psi) = −16.6999 − 0.0101059 T + 0.00116512 T² + 0.173354 T V + 4.24267 V
 * − 0.0684226 V² (T in °F). Widely used fit to the standard carbonation table.
 */
export function kegPressure(tempC: number, targetVolumes: number): CalcResult<number> {
  const err = outside("Temperature", tempC, -2, 25) ?? outside("Target CO2", targetVolumes, 1, 5);
  if (err) return fail(err);
  const t = cToF(tempC);
  const v = targetVolumes;
  const psi =
    -16.6999 -
    0.0101059 * t +
    0.00116512 * t ** 2 +
    0.173354 * t * v +
    4.24267 * v -
    0.0684226 * v ** 2;
  return ok(psiToKpa(psi));
}
