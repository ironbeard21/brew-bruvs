// SPDX-License-Identifier: AGPL-3.0-or-later
import { type CalcResult, fail, ok, outside } from "./result.ts";

export interface HopAddition {
  alphaAcidPct: number;
  hopGrams: number;
  /** Minutes in the boil. */
  minutes: number;
}

export interface Wort {
  /** Volume of finished beer, liters. */
  volumeL: number;
  /** Average gravity during the boil. */
  boilSg: number;
}

function check(hop: HopAddition, wort: Wort): string | null {
  return (
    outside("Alpha acid", hop.alphaAcidPct, 0, 30) ??
    outside("Hop weight", hop.hopGrams, 0, 100000) ??
    outside("Boil time", hop.minutes, 0, 240) ??
    outside("Volume", wort.volumeL, 0.1, 100000) ??
    outside("Boil gravity", wort.boilSg, 1.0, 1.2)
  );
}

const alphaMgPerL = (hop: HopAddition, wort: Wort): number =>
  ((hop.alphaAcidPct / 100) * hop.hopGrams * 1000) / wort.volumeL;

/**
 * Tinseth decimal utilization (Glenn Tinseth, 1997):
 * 1.65 × 0.000125^(boil SG − 1) × (1 − e^(−0.04 × minutes)) / 4.15.
 */
export const tinsethUtilization = (boilSg: number, minutes: number): number =>
  1.65 * 0.000125 ** (boilSg - 1) * ((1 - Math.exp(-0.04 * minutes)) / 4.15);

/** IBUs from one addition, Tinseth: utilization × mg/L of added alpha acids. */
export function tinsethIbu(hop: HopAddition, wort: Wort): CalcResult<number> {
  const err = check(hop, wort);
  return err ? fail(err) : ok(tinsethUtilization(wort.boilSg, hop.minutes) * alphaMgPerL(hop, wort));
}

/** Rager decimal utilization (Jackie Rager, 1990): (18.11 + 13.86 × tanh((t − 31.32) / 18.27)) / 100. */
export const ragerUtilization = (minutes: number): number =>
  (18.11 + 13.86 * Math.tanh((minutes - 31.32) / 18.27)) / 100;

/**
 * IBUs from one addition, Rager: utilization × mg/L alpha acids / (1 + GA),
 * GA = (boil SG − 1.050) / 0.2 above 1.050, otherwise 0.
 */
export function ragerIbu(hop: HopAddition, wort: Wort): CalcResult<number> {
  const err = check(hop, wort);
  if (err) return fail(err);
  const ga = wort.boilSg > 1.05 ? (wort.boilSg - 1.05) / 0.2 : 0;
  return ok((ragerUtilization(hop.minutes) * alphaMgPerL(hop, wort)) / (1 + ga));
}

/** Total IBUs for several additions with the chosen method. */
export function totalIbu(
  hops: HopAddition[],
  wort: Wort,
  method: "tinseth" | "rager" = "tinseth",
): CalcResult<number> {
  const calc = method === "tinseth" ? tinsethIbu : ragerIbu;
  let total = 0;
  for (const hop of hops) {
    const r = calc(hop, wort);
    if (!r.ok) return r;
    total += r.value;
  }
  return ok(total);
}
