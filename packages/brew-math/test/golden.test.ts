// SPDX-License-Identifier: AGPL-3.0-or-later
import * as carbonation from "../src/carbonation.ts";
import * as color from "../src/color.ts";
import * as dilution from "../src/dilution.ts";
import * as gravity from "../src/gravity.ts";
import * as hydrometer from "../src/hydrometer.ts";
import * as ibu from "../src/ibu.ts";
import * as mashWater from "../src/mash-water.ts";
import * as meadWine from "../src/mead-wine.ts";
import * as refractometer from "../src/refractometer.ts";
import * as units from "../src/units.ts";
import * as yeast from "../src/yeast.ts";
import { type GoldenCase, runGolden } from "./golden.ts";
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

type Golden = Record<string, GoldenCase[]>;

runGolden(units, unitsCases as Golden);
runGolden(gravity, gravityCases as Golden);
runGolden(hydrometer, hydrometerCases as Golden);
runGolden(refractometer, refractometerCases as Golden);
runGolden(mashWater, mashWaterCases as Golden);
runGolden(dilution, dilutionCases as Golden);
runGolden(carbonation, carbonationCases as Golden);
runGolden(yeast, yeastCases as Golden);
runGolden(ibu, ibuCases as Golden);
runGolden(color, colorCases as Golden);
runGolden(meadWine, meadWineCases as Golden);
