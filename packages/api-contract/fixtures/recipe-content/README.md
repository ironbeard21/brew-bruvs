# Recipe content fixtures

Example documents for the `RecipeContent` contract (`recipe_versions.content`), defined in
`apps/server/src/contracts/recipe-content.ts` and published as `../../recipe-content.schema.json`.

- `valid/`: one recipe each for beer, mead, wine and cider. Catalog ids are real seed ids.
- `invalid/`: the beer recipe with one thing wrong. Each file is `{ why, path, content }`, where
  `path` is where validation must report the problem (`""` is the document itself).

Importers (BeerXML, BeerJSON, URL) should produce documents like `valid/`, and their tests can use
these files as expected output. `apps/server/test/recipe-content.test.ts` checks every file.
