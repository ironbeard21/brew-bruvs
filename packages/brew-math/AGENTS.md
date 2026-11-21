# AGENTS.md — packages/brew-math

Adds to the root `AGENTS.md`. Lead: Claude. Reviewer: Codex.

Every number Brew-Bruvs shows comes from here, so correctness beats everything else in this package.

## Rules

- Pure TypeScript functions. No runtime dependencies, no I/O, no dates, no randomness. Runs the same in the server, the app and offline.
- Inputs and outputs in SI units and specific gravity (kg, L, °C, SG). Unit conversion lives in `src/units/` and is the only place that knows about °F, gallons, pounds, °Plato, Brix, SRM/EBC/°L.
- One file per calculator group: `gravity`, `hydrometer`, `refractometer`, `mash-water`, `ibu`, `color`, `carbonation`, `yeast`, `dilution`, `mead-wine` (honey/sugar, nutrients, sulfite, acid, backsweetening, chaptalization, blending), `units`.
- Every exported function has a JSDoc comment naming the formula and its published source (e.g. "Tinseth, 1997"), its units, and its valid input range.
- Out-of-range inputs return a typed error result; don't throw for normal user mistakes.
- When there's more than one accepted formula (ABV standard vs alternate, Tinseth vs Rager), export each with a clear name; let the caller choose.

## Tests

- Golden tests in `test/golden/<calculator>.json`: inputs, expected output and tolerance, and where the expected value came from (book, paper or a named reference calculator).
- At least 5 golden cases per formula, including edges (very high gravity, 0 °C, tiny volumes).
- Round-trip tests for every unit conversion.
- Coverage target: 100% of lines in this package. CI fails below it.

## Don't

- Don't import from other workspace packages.
- Don't round inside formulas; round only in the UI.
- Don't change a formula's output without updating its golden tests and explaining why in the PR.
