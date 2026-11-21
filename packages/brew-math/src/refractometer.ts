// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { platoToSg } from "./units.ts";

/** Typical wort correction factor; users can calibrate their own. */
export const DEFAULT_WORT_CORRECTION = 1.04;

/** Specific gravity of unfermented wort or must from a refractometer Brix reading. */
export function refractometerSg(
  brix: number,
  wortCorrection = DEFAULT_WORT_CORRECTION,
): CalcResult<number> {
  const err = outside("Brix", brix, 0, 40) ?? outside("Wort correction", wortCorrection, 0.9, 1.2);
  return err ? fail(err) : ok(platoToSg(brix / wortCorrection));
}

/**
 * Final gravity from original and current refractometer readings once fermentation has
 * produced alcohol. Sean Terrill's cubic (2011), with both readings divided by the wort
 * correction factor.
 */
export function refractometerFinalGravity(
  originalBrix: number,
  currentBrix: number,
  wortCorrection = DEFAULT_WORT_CORRECTION,
): CalcResult<number> {
  const err =
    outside("Original Brix", originalBrix, 0, 40) ??
    outside("Current Brix", currentBrix, 0, 40) ??
    outside("Wort correction", wortCorrection, 0.9, 1.2) ??
    (currentBrix > originalBrix ? "Current Brix can't be higher than original Brix" : null);
  if (err) return fail(err);
  const ob = originalBrix / wortCorrection;
  const fb = currentBrix / wortCorrection;
  return ok(
    1 -
      0.0044993 * ob +
      0.011774 * fb +
      0.00027581 * ob ** 2 -
      0.0012717 * fb ** 2 -
      0.00000728 * ob ** 3 +
      0.000063293 * fb ** 3,
  );
}
