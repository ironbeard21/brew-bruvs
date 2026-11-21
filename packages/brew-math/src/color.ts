// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";
import { kgToLb, litersToGallons } from "./units.ts";

export interface GrainColor {
  kg: number;
  lovibond: number;
}

/** Malt color units: Σ(pounds × °L) / US gallons. */
export function mcu(grains: GrainColor[], volumeL: number): CalcResult<number> {
  const err =
    outside("Volume", volumeL, 0.1, 100000) ??
    grains
      .map(
        (g) =>
          outside("Grain weight", g.kg, 0, 100000) ?? outside("Grain color", g.lovibond, 0, 700),
      )
      .find((e) => e !== null) ??
    null;
  if (err) return fail(err);
  const sum = grains.reduce((s, g) => s + kgToLb(g.kg) * g.lovibond, 0);
  return ok(sum / litersToGallons(volumeL));
}

/** Beer color in SRM from a grain bill, Morey (1994): 1.4922 × MCU^0.6859. */
export function moreySrm(grains: GrainColor[], volumeL: number): CalcResult<number> {
  const m = mcu(grains, volumeL);
  return m.ok ? ok(1.4922 * m.value ** 0.6859) : m;
}
