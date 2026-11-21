// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { cToF } from "./units.ts";

/** Water density polynomial in °F used by the standard homebrew hydrometer correction. */
const density = (tF: number): number =>
  1.00130346 - 0.000134722124 * tF + 0.00000204052596 * tF ** 2 - 0.00000000232820948 * tF ** 3;

/**
 * Corrects a hydrometer reading taken at a temperature other than the hydrometer's
 * calibration temperature: corrected = reading × density(sample) / density(calibration).
 * Default calibration 15.56 °C (60 °F). Valid for samples 0–60 °C.
 */
export function correctHydrometer(
  readingSg: number,
  sampleTempC: number,
  calibrationTempC = 15.56,
): CalcResult<number> {
  const err =
    outside("Reading", readingSg, 0.98, 1.2) ??
    outside("Sample temperature", sampleTempC, 0, 60) ??
    outside("Calibration temperature", calibrationTempC, 0, 30);
  if (err) return fail(err);
  return ok((readingSg * density(cToF(sampleTempC))) / density(cToF(calibrationTempC)));
}
