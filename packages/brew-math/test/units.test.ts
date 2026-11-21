// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import * as brewMath from "../src/index.ts";
import * as u from "../src/units.ts";

const values = [0, 0.5, 1, 4.2, 20, 100, 1234.5];
const pairs: [string, (x: number) => number, (x: number) => number][] = [
  ["kg ↔ lb", u.kgToLb, u.lbToKg],
  ["g ↔ oz", u.gToOz, u.ozToG],
  ["L ↔ gal", u.litersToGallons, u.gallonsToLiters],
  ["L ↔ qt", u.litersToQuarts, u.quartsToLiters],
  ["°C ↔ °F", u.cToF, u.fToC],
  ["psi ↔ kPa", u.psiToKpa, u.kpaToPsi],
  ["bar ↔ kPa", u.barToKpa, u.kpaToBar],
  ["SRM ↔ EBC", u.srmToEbc, u.ebcToSrm],
  ["°L ↔ SRM", u.lovibondToSrm, u.srmToLovibond],
];

describe("unit round trips", () => {
  for (const [name, to, back] of pairs) {
    it(name, () => {
      for (const v of values)
        expect(Math.abs(back(to(v)) - v)).toBeLessThanOrEqual(1e-9 * Math.max(1, v));
    });
  }

  it("SG → °P → SG within 0.0002 over 1.000–1.130", () => {
    for (let sg = 1.0; sg <= 1.13; sg += 0.005) {
      expect(Math.abs(u.platoToSg(u.sgToPlato(sg)) - sg)).toBeLessThanOrEqual(0.0002);
    }
  });

  it("Brix uses the Plato conversions", () => {
    expect(u.sgToBrix).toBe(u.sgToPlato);
    expect(u.brixToSg).toBe(u.platoToSg);
  });
});

describe("package entry point", () => {
  it("exports every calculator and the units namespace", () => {
    for (const name of [
      "abvStandard",
      "correctHydrometer",
      "refractometerFinalGravity",
      "strikeTemperature",
      "gravityAdjustment",
      "primingSugar",
      "kegPressure",
      "cellsNeeded",
      "starterCells",
      "tinsethIbu",
      "ragerIbu",
      "moreySrm",
      "sugarToRaiseGravity",
      "nutrientPlan",
      "freeSo2Needed",
      "acidAddition",
      "blend",
    ]) {
      expect(typeof (brewMath as Record<string, unknown>)[name]).toBe("function");
    }
    expect(brewMath.units.sgToPlato).toBe(u.sgToPlato);
  });
});
