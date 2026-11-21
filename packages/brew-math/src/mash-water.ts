// SPDX-License-Identifier: AGPL-3.0-or-later
// Infusion mash equations from John Palmer, "How to Brew", metric form (constant 0.41 for L/kg).
import { type CalcResult, fail, ok, outside } from "./result.ts";

/**
 * Strike water temperature °C: Tw = (0.41 / r) × (T2 − T1) + T2,
 * r = water-to-grain ratio (L/kg), T1 = grain temperature, T2 = target mash temperature.
 */
export function strikeTemperature(
  waterToGrainLPerKg: number,
  grainTempC: number,
  targetMashTempC: number,
): CalcResult<number> {
  const err =
    outside("Water-to-grain ratio", waterToGrainLPerKg, 1, 8) ??
    outside("Grain temperature", grainTempC, -10, 50) ??
    outside("Target mash temperature", targetMashTempC, 35, 80);
  if (err) return fail(err);
  return ok((0.41 / waterToGrainLPerKg) * (targetMashTempC - grainTempC) + targetMashTempC);
}

/**
 * Volume (L) of hot water to raise a mash from T1 to T2:
 * Wa = (T2 − T1) × (0.41 × G + Wm) / (Tw − T2), G = grain kg, Wm = water already in mash (L).
 */
export function infusionVolume(input: {
  currentTempC: number;
  targetTempC: number;
  grainKg: number;
  waterInMashL: number;
  infusionTempC?: number;
}): CalcResult<number> {
  const { currentTempC, targetTempC, grainKg, waterInMashL, infusionTempC = 100 } = input;
  const err =
    outside("Current temperature", currentTempC, 0, 100) ??
    outside("Target temperature", targetTempC, 0, 100) ??
    outside("Grain weight", grainKg, 0.01, 10000) ??
    outside("Water in mash", waterInMashL, 0, 100000) ??
    outside("Infusion water temperature", infusionTempC, 0, 100) ??
    (targetTempC <= currentTempC ? "Target temperature must be above current temperature" : null) ??
    (infusionTempC <= targetTempC ? "Infusion water must be hotter than the target" : null);
  if (err) return fail(err);
  return ok(
    ((targetTempC - currentTempC) * (0.41 * grainKg + waterInMashL)) /
      (infusionTempC - targetTempC),
  );
}
