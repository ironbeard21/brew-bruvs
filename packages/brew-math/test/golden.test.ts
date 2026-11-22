// SPDX-License-Identifier: AGPL-3.0-or-later
import * as brewMath from "../src/index.ts";
import carbonationCases from "./golden/carbonation.json" with { type: "json" };
import colorCases from "./golden/color.json" with { type: "json" };
import dilutionCases from "./golden/dilution.json" with { type: "json" };
import gravityCases from "./golden/gravity.json" with { type: "json" };
import hydrometerCases from "./golden/hydrometer.json" with { type: "json" };
import ibuCases from "./golden/ibu.json" with { type: "json" };
import mashWaterCases from "./golden/mash-water.json" with { type: "json" };
import meadWineCases from "./golden/mead-wine.json" with { type: "json" };
import refractometerCases from "./golden/refractometer.json" with { type: "json" };
import unitsCases from "./golden/units.json" with { type: "json" };
import yeastCases from "./golden/yeast.json" with { type: "json" };
import { type GoldenCase, runGolden } from "./golden.ts";

type Golden = Record<string, GoldenCase[]>;

runGolden(brewMath.units, unitsCases as Golden);
runGolden(brewMath, gravityCases as Golden);
runGolden(brewMath, hydrometerCases as Golden);
runGolden(brewMath, refractometerCases as Golden);
runGolden(brewMath, mashWaterCases as Golden);
runGolden(brewMath, dilutionCases as Golden);
runGolden(brewMath, carbonationCases as Golden);
runGolden(brewMath, yeastCases as Golden);
runGolden(brewMath, ibuCases as Golden);
runGolden(brewMath, colorCases as Golden);
runGolden(brewMath, meadWineCases as Golden);
