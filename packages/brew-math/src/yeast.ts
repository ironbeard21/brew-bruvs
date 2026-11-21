// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { sgToPlato } from "./units.ts";

/** Pitch rates in million cells per mL per °Plato. */
export const ALE_PITCH_RATE = 0.75;
export const LAGER_PITCH_RATE = 1.5;

/** Billion cells needed: rate × volume (mL) × °P / 1000. */
export function cellsNeeded(volumeL: number, og: number, pitchRate: number): CalcResult<number> {
  const err =
    outside("Volume", volumeL, 0.1, 100000) ??
    outside("Original gravity", og, 1.001, 1.2) ??
    outside("Pitch rate", pitchRate, 0.1, 3);
  if (err) return fail(err);
  return ok((pitchRate * volumeL * 1000 * sgToPlato(og)) / 1000);
}

/** Whole packs needed when each pack holds `viableCellsPerPack` billion live cells. */
export function packsNeeded(cellsNeededBillion: number, viableCellsPerPack: number): CalcResult<number> {
  const err =
    outside("Cells needed", cellsNeededBillion, 0, 100000) ??
    outside("Cells per pack", viableCellsPerPack, 1, 10000);
  return err ? fail(err) : ok(Math.ceil(cellsNeededBillion / viableCellsPerPack));
}

/**
 * Cells after a stir-plate starter, using Kai Troester's growth model (braukaiser.com):
 * growth per gram of extract is 1.4 billion when the inoculation rate is below 1.4 billion/g,
 * 2.33 − 0.67 × rate between 1.4 and 3.5, and none above 3.5.
 */
export function starterCells(input: {
  initialCellsBillion: number;
  starterVolumeL: number;
  starterSg?: number;
}): CalcResult<{ extractG: number; newCellsBillion: number; totalCellsBillion: number }> {
  const { initialCellsBillion, starterVolumeL, starterSg = 1.036 } = input;
  const err =
    outside("Initial cells", initialCellsBillion, 1, 10000) ??
    outside("Starter volume", starterVolumeL, 0.1, 100) ??
    outside("Starter gravity", starterSg, 1.02, 1.06);
  if (err) return fail(err);
  const extractG = starterVolumeL * 1000 * starterSg * (sgToPlato(starterSg) / 100);
  const rate = initialCellsBillion / extractG;
  const growthPerGram = rate < 1.4 ? 1.4 : rate < 3.5 ? 2.33 - 0.67 * rate : 0;
  const newCellsBillion = growthPerGram * extractG;
  return ok({ extractG, newCellsBillion, totalCellsBillion: initialCellsBillion + newCellsBillion });
}
