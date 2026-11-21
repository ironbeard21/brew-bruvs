// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";

/**
 * Volume change to move wort or must from one gravity to another, by conserving gravity
 * points: V2 = V1 × (SG1 − 1) / (SG2 − 1). `changeL` is water to add when positive and
 * volume to boil off when negative.
 */
export function gravityAdjustment(
  volumeL: number,
  currentSg: number,
  targetSg: number,
): CalcResult<{ finalVolumeL: number; changeL: number }> {
  const err =
    outside("Volume", volumeL, 0.01, 100000) ??
    outside("Current gravity", currentSg, 1.001, 1.2) ??
    outside("Target gravity", targetSg, 1.001, 1.2);
  if (err) return fail(err);
  const finalVolumeL = (volumeL * (currentSg - 1)) / (targetSg - 1);
  return ok({ finalVolumeL, changeL: finalVolumeL - volumeL });
}
