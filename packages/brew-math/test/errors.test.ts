// SPDX-License-Identifier: AGPL-3.0-or-later
// Every calculator returns an error result (never throws) for inputs it can't handle.
import { describe, expect, it } from "vitest";
import { kegPressure, primingSugar, residualCo2 } from "../src/carbonation.ts";
import { mcu, moreySrm } from "../src/color.ts";
import { gravityAdjustment } from "../src/dilution.ts";
import {
  abvAlternate,
  abvStandard,
  apparentAttenuation,
  caloriesPer355ml,
  realAttenuation,
} from "../src/gravity.ts";
import { correctHydrometer } from "../src/hydrometer.ts";
import { ragerIbu, tinsethIbu, totalIbu } from "../src/ibu.ts";
import { infusionVolume, spargeVolume, strikeTemperature } from "../src/mash-water.ts";
import {
  acidAddition,
  blend,
  freeSo2Needed,
  nutrientPlan,
  potassiumMetabisulfite,
  potassiumSorbate,
  sugarToRaiseGravity,
  yanTarget,
} from "../src/mead-wine.ts";
import { estimateFg, estimateOg, recipeStats, scaleFactors } from "../src/recipe.ts";
import { refractometerFinalGravity, refractometerSg } from "../src/refractometer.ts";
import type { CalcResult } from "../src/result.ts";
import { cellsNeeded, packsNeeded, starterCells } from "../src/yeast.ts";

const hop = { alphaAcidPct: 12, hopGrams: 28, minutes: 60 };
const wort = { volumeL: 20, boilSg: 1.05 };
const mashIn = { currentTempC: 52, targetTempC: 63, grainKg: 5, waterInMashL: 15 };
const plan = {
  volumeL: 19,
  og: 1.1,
  expectedFg: 1.0,
  need: "medium" as const,
  nitrogenFraction: 0.21,
};
const malt = { kg: 4.5, potentialSg: 1.037, mashed: true, colorEbc: 4 };
const brew = {
  volumeL: 20,
  efficiencyPct: 72,
  fermentables: [malt],
  attenuationPct: 75,
  hops: [hop],
};

const cases: [string, () => CalcResult<unknown>, string][] = [
  ["abvStandard: OG too high", () => abvStandard(1.5, 1.01), "Original gravity"],
  ["abvStandard: FG above OG", () => abvStandard(1.04, 1.05), "higher than original"],
  ["abvStandard: not a number", () => abvStandard(Number.NaN, 1.01), "must be a number"],
  ["abvAlternate: FG too low", () => abvAlternate(1.05, 0.9), "Final gravity"],
  ["apparentAttenuation: OG of 1.000", () => apparentAttenuation(1.0, 1.0), "above 1.000"],
  ["realAttenuation: OG of 1.000", () => realAttenuation(1.0, 0.99), "above 1.000"],
  ["caloriesPer355ml: FG above OG", () => caloriesPer355ml(1.04, 1.05), "higher than original"],
  ["correctHydrometer: sample too hot", () => correctHydrometer(1.05, 80), "Sample temperature"],
  ["refractometerSg: Brix too high", () => refractometerSg(55), "Brix"],
  [
    "refractometerFinalGravity: current above original",
    () => refractometerFinalGravity(10, 12),
    "higher than original",
  ],
  [
    "refractometerFinalGravity: bad correction factor",
    () => refractometerFinalGravity(12, 6, 2),
    "Wort correction",
  ],
  ["strikeTemperature: ratio too thin", () => strikeTemperature(20, 20, 67), "ratio"],
  [
    "infusionVolume: target below current",
    () => infusionVolume({ ...mashIn, targetTempC: 50 }),
    "above current",
  ],
  [
    "infusionVolume: water not hot enough",
    () => infusionVolume({ ...mashIn, infusionTempC: 60 }),
    "hotter",
  ],
  ["gravityAdjustment: no volume", () => gravityAdjustment(0, 1.05, 1.04), "Volume"],
  ["residualCo2: too hot", () => residualCo2(40), "Beer temperature"],
  [
    "primingSugar: no volume",
    () => primingSugar({ volumeL: 0, beerTempC: 20, targetVolumes: 2.4, sugar: "corn-sugar" }),
    "Volume",
  ],
  [
    "primingSugar: bad beer temperature",
    () => primingSugar({ volumeL: 19, beerTempC: 45, targetVolumes: 2.4, sugar: "corn-sugar" }),
    "Beer temperature",
  ],
  [
    "primingSugar: already carbonated",
    () => primingSugar({ volumeL: 19, beerTempC: 0, targetVolumes: 1.2, sugar: "corn-sugar" }),
    "already",
  ],
  ["kegPressure: too warm", () => kegPressure(40, 2.5), "Temperature"],
  ["cellsNeeded: pitch rate too high", () => cellsNeeded(20, 1.05, 10), "Pitch rate"],
  ["packsNeeded: tiny packs", () => packsNeeded(200, 0), "Cells per pack"],
  [
    "starterCells: starter too strong",
    () => starterCells({ initialCellsBillion: 100, starterVolumeL: 1, starterSg: 1.1 }),
    "Starter gravity",
  ],
  [
    "tinsethIbu: alpha too high",
    () => tinsethIbu({ ...hop, alphaAcidPct: 40 }, wort),
    "Alpha acid",
  ],
  ["ragerIbu: no volume", () => ragerIbu(hop, { ...wort, volumeL: 0 }), "Volume"],
  [
    "totalIbu: one bad addition",
    () => totalIbu([hop, { ...hop, minutes: 500 }], wort),
    "Boil time",
  ],
  ["mcu: no volume", () => mcu([{ kg: 4, lovibond: 2 }], 0), "Volume"],
  ["mcu: impossible grain color", () => mcu([{ kg: 4, lovibond: 900 }], 20), "Grain color"],
  ["moreySrm: no volume", () => moreySrm([{ kg: 4, lovibond: 2 }], 0), "Volume"],
  [
    "sugarToRaiseGravity: target below current",
    () =>
      sugarToRaiseGravity({
        volumeL: 19,
        currentSg: 1.05,
        targetSg: 1.04,
        pointsPerPoundPerGallon: 35,
      }),
    "at least",
  ],
  ["yanTarget: OG of water", () => yanTarget(1.0, "low"), "Original gravity"],
  ["nutrientPlan: bad OG", () => nutrientPlan({ ...plan, og: 1.5 }), "Original gravity"],
  [
    "nutrientPlan: FG above OG",
    () => nutrientPlan({ ...plan, expectedFg: 1.11 }),
    "Expected final gravity",
  ],
  ["freeSo2Needed: pH too high", () => freeSo2Needed(5), "pH"],
  ["potassiumMetabisulfite: no volume", () => potassiumMetabisulfite(30, 0), "Volume"],
  [
    "acidAddition: target below current",
    () => acidAddition({ volumeL: 19, currentTa: 7, targetTa: 6, acid: "tartaric" }),
    "at least",
  ],
  ["blend: one lot", () => blend([{ volumeL: 10 }]), "two lots"],
  [
    "spargeVolume: no pre-boil volume",
    () => spargeVolume({ preBoilVolumeL: 0, mashWaterL: 15, grainKg: 5 }),
    "Pre-boil",
  ],
  ["potassiumSorbate: ABV too high", () => potassiumSorbate(18, 19), "ABV"],
  ["estimateOg: no volume", () => estimateOg({ ...brew, volumeL: 0 }), "Volume"],
  ["estimateOg: zero efficiency", () => estimateOg({ ...brew, efficiencyPct: 0 }), "Efficiency"],
  [
    "estimateOg: potential in PPG instead of SG",
    () => estimateOg({ ...brew, fermentables: [{ ...malt, potentialSg: 37 }] }),
    "Potential",
  ],
  [
    "estimateOg: impossible colour",
    () => estimateOg({ ...brew, fermentables: [{ ...malt, colorEbc: 9000 }] }),
    "Colour",
  ],
  [
    "estimateOg: juice gravity in Brix",
    () => estimateOg({ ...brew, fermentables: [{ liters: 10, sg: 12 }] }),
    "Juice gravity",
  ],
  [
    "estimateOg: more juice than batch",
    () => estimateOg({ ...brew, fermentables: [{ liters: 25, sg: 1.05 }] }),
    "more than the batch",
  ],
  ["estimateFg: attenuation over 110%", () => estimateFg(1.05, 150), "Attenuation"],
  ["recipeStats: bad OG inputs", () => recipeStats({ ...brew, volumeL: 0 }), "Volume"],
  [
    "recipeStats: bad attenuation",
    () => recipeStats({ ...brew, attenuationPct: -5 }),
    "Attenuation",
  ],
  [
    "recipeStats: OG beyond ABV formulas",
    () => recipeStats({ ...brew, volumeL: 1, fermentables: [{ ...malt, kg: 10 }] }),
    "Original gravity",
  ],
  [
    "recipeStats: boil volume below batch",
    () => recipeStats({ ...brew, boilVolumeL: 10 }),
    "Boil volume",
  ],
  [
    "recipeStats: bad hop addition",
    () => recipeStats({ ...brew, hops: [{ ...hop, alphaAcidPct: 40 }] }),
    "Alpha acid",
  ],
  [
    "recipeStats: grain colour beyond Morey",
    () => recipeStats({ ...brew, fermentables: [{ ...malt, colorEbc: 4000 }] }),
    "Grain color",
  ],
  [
    "scaleFactors: efficiency as a fraction",
    () =>
      scaleFactors({ fromVolumeL: 20, toVolumeL: 40, fromEfficiencyPct: 72, toEfficiencyPct: 0.8 }),
    "New efficiency",
  ],
  ["blend: empty lot", () => blend([{ volumeL: 10 }, { volumeL: 0 }]), "Lot volume"],
];

describe("out-of-range inputs", () => {
  for (const [name, run, message] of cases) {
    it(name, () => {
      const r = run();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message.includes(message)).toBe(true);
    });
  }

  it("uses invalid_input for structural problems and out_of_range for values", () => {
    const one = blend([{ volumeL: 10 }]);
    const hot = residualCo2(40);
    expect(!one.ok && one.error.code).toBe("invalid_input");
    expect(!hot.ok && hot.error.code).toBe("out_of_range");
  });
});

describe("starterCells growth model branches", () => {
  const grow = (initialCellsBillion: number) => {
    const r = starterCells({ initialCellsBillion, starterVolumeL: 1 });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it("grows 1.4 billion cells per gram below 1.4 billion/g inoculation", () => {
    const r = grow(50);
    expect(Math.abs(r.newCellsBillion / r.extractG - 1.4)).toBeLessThanOrEqual(1e-12);
  });

  it("grows less as inoculation rises between 1.4 and 3.5 billion/g", () => {
    const r = grow(250);
    const rate = 250 / r.extractG;
    expect(Math.abs(r.newCellsBillion / r.extractG - (2.33 - 0.67 * rate))).toBeLessThanOrEqual(
      1e-12,
    );
  });

  it("grows nothing above 3.5 billion/g", () => {
    expect(grow(500).newCellsBillion).toBe(0);
  });
});
