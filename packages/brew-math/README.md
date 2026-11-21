# @brew-bruvs/brew-math

Every brewing calculation in Brew-Bruvs. Pure TypeScript, no dependencies, works offline. Inputs and outputs are SI units and specific gravity; convert for display with `units`.

Calculators return `{ ok: true, value }` or `{ ok: false, error: { code, message } }` instead of throwing.

| Module | Functions |
| --- | --- |
| `units` | mass, volume, temperature, pressure, SG ↔ °Plato/Brix, SRM ↔ EBC ↔ °L |
| `gravity` | `abvStandard`, `abvAlternate`, `apparentAttenuation`, `realAttenuation`, `caloriesPer355ml` |
| `hydrometer` | `correctHydrometer` |
| `refractometer` | `refractometerSg`, `refractometerFinalGravity` (Terrill cubic) |
| `mash-water` | `strikeTemperature`, `infusionVolume` (Palmer) |
| `dilution` | `gravityAdjustment` |
| `carbonation` | `residualCo2`, `primingSugar`, `kegPressure` |
| `yeast` | `cellsNeeded`, `packsNeeded`, `starterCells` (Troester stir-plate model) |
| `ibu` | `tinsethUtilization`, `tinsethIbu`, `ragerUtilization`, `ragerIbu`, `totalIbu` |
| `color` | `mcu`, `moreySrm` |
| `mead-wine` | `sugarToRaiseGravity`, `yanTarget`, `nutrientPlan`, `freeSo2Needed`, `potassiumMetabisulfite`, `acidAddition`, `blend` |

## Tests

`test/golden/*.json` holds the expected values; every case names its source. Published references used: Tinseth's utilization table, the Scott Labs Winemaking Handbook nitrogen table, Palmer's strike-water example, and Plato/SG reference tables. Other cases come from `test/golden/generate.py`, an independent Python implementation of each formula (`python3 test/golden/generate.py` rewrites the JSON).

## Known open points

- **Medium-nitrogen YAN:** the formula uses sugar × 0.90 (Scott Labs 2016 handbook). The 2022 handbook table lists higher medium values above 24 °Brix (e.g. 280 vs 270 ppm at 30 °Brix). Low and high match both. Decide which to follow.
- **Priming sugar:** uses the common calculator convention (15.195 g corn sugar per gallon per volume; table sugar × 0.91). Other sugars (DME, honey) aren't included yet.
- **Nutrient timing:** half 12–24 h after pitching, half at 1/3 sugar depletion (Oregon State extension guidance). A full TOSNA schedule isn't implemented because its exact rules weren't confirmed from a primary source.
- **Beer color swatch (SRM → screen color):** left for the app (P0-12) with a sourced SRM color table.
