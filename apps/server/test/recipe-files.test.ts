// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { importCatalog } from "@brew-bruvs/catalog-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { RecipeContent } from "../src/contracts/recipe-content.ts";
import { ImportedRecipeDraft } from "../src/contracts/recipe-file.ts";
import { exportBeerJson, importBeerJson } from "../src/importers/beerjson.ts";
import { exportBeerXml, importBeerXml } from "../src/importers/beerxml.ts";
import { call, offlineDeps, TEST_DATABASE_URL, twoUsers, withApp } from "./helpers.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const xmlFixture = read("./fixtures/recipe-files/external.xml");
const jsonFixture = read("./fixtures/recipe-files/external.json");
const formats = [
  { name: "beerxml", export: exportBeerXml, import: importBeerXml },
  { name: "beerjson", export: exportBeerJson, import: importBeerJson },
] as const;

describe.each(formats)("$name golden recipe round trips", (format) => {
  it.each(["beer", "mead", "wine", "cider"] as const)("preserves the %s content", (beverage) => {
    const fixture = read(
      `../../../packages/api-contract/fixtures/recipe-content/valid/${beverage}.json`,
    );
    const recipe = {
      name: "Golden & grain <recipe>",
      beverage,
      batchSizeL: 20,
      content: RecipeContent.parse(JSON.parse(fixture)),
      credit: {
        sourceUrl: "https://example.test/recipe",
        author: "Robin Brewer",
        publicSharingBlocked: true,
      },
    };
    expect(format.import(format.export(recipe))).toEqual({ recipe, native: true });
    const edited = format.import(format.export(recipe).replace("Golden", "Edited"));
    expect(edited.recipe.name).toContain("Edited");
    expect(edited.recipe.credit).toEqual(recipe.credit);
  });
});

it("parses standard BeerXML fields, notes and water additions", () => {
  const { recipe, native } = importBeerXml(xmlFixture);
  expect(native).toBe(false);
  expect(recipe).toMatchObject({
    name: "Harbor Pale & Unusual",
    beverage: "beer",
    credit: { sourceUrl: null, author: "Robin Brewer" },
    content: {
      hops: [
        { name: "Zeus", amountKg: 0.03, use: "boil", timeMin: 60 },
        { name: "Experimental Hop 123", use: "dry_hop", days: 2 },
      ],
      miscs: [
        { name: "House clarifier", amountKg: 0.002 },
        { name: "Spring Water", amountL: 7 },
      ],
      fermentation: [{ stage: "primary", days: 12, tempC: 19 }],
      targets: { og: 1.05 },
    },
  });
});

it("converts BeerJSON volume, mass, temperature, duration and gravity to the recipe contract", () => {
  const { recipe, native } = importBeerJson(jsonFixture);
  expect(native).toBe(false);
  expect(recipe.beverage).toBe("cider");
  expect(recipe.batchSizeL).toBeCloseTo(18.92705892);
  expect(recipe.content.fermentables[0]?.amountL).toBeCloseTo(18.92705892);
  expect(recipe.content.fermentables[1]?.amountKg).toBeCloseTo(0.680388555);
  expect(recipe.content.miscs[0]).toMatchObject({ count: 2, use: "secondary", dayOffset: 1 });
  expect(recipe.content.yeasts[0]).toMatchObject({ packs: 1, form: "dry" });
  expect(recipe.content.fermentation[0]).toMatchObject({ tempC: 20, days: 14 });
  expect(recipe.content.targets?.og).toBeCloseTo(1.048, 3);
});

it("rejects XML document types and files with more than one recipe", () => {
  expect(() => importBeerXml("<!DOCTYPE RECIPES><RECIPES/>")).toThrow("document types");
  expect(() => importBeerJson('{"beerjson":{"version":1,"recipes":[{},{}]}}')).toThrow(
    "exactly one",
  );
  expect(() => importBeerJson("{broken")).toThrow("syntax");
});

it("requires a session to preview a file", async () => {
  const response = await call(createApp(offlineDeps()), "POST", "/api/recipes/import", {
    body: { format: "beerxml", contents: xmlFixture },
  });
  expect(response.status).toBe(401);
});

describe.skipIf(!TEST_DATABASE_URL)("recipe file API on PostgreSQL", () => {
  it("matches aliases, keeps unmatched lines, preserves file credit, and only saves on confirmation", async () => {
    await withApp({}, async (app, sql) => {
      const { adminToken, annToken } = await twoUsers(app);
      await importCatalog(drizzle(sql));
      const preview = await call(app, "POST", "/api/recipes/import", {
        token: adminToken,
        body: { format: "beerxml", contents: xmlFixture },
      });
      expect(preview.status).toBe(200);
      const draft = ImportedRecipeDraft.parse(preview.json);
      expect(draft.content.hops[0]).toMatchObject({ name: "Zeus", catalogId: "hop-columbus" });
      expect(draft.content.hops[1]?.catalogId).toBeUndefined();
      expect(draft.content.hops[1]?.name).toBe("Experimental Hop 123");
      expect(draft.visibility).toBe("private");
      expect(Number((await sql.query("SELECT count(*) FROM recipes")).rows[0]?.count)).toBe(0);

      const saved = await call(app, "POST", "/api/recipes", {
        body: { ...draft, styleId: "style-bjcp-2021-21a" },
        token: adminToken,
      });
      expect(saved.status).toBe(201);
      expect(saved.json.credit).toMatchObject({ author: "Robin Brewer", sourceUrl: null });
      const newer = await call(app, "POST", `/api/recipes/${saved.json.id}/versions`, {
        body: { name: "Second version", batchSizeL: draft.batchSizeL, content: draft.content },
        token: adminToken,
      });
      expect(newer.status).toBe(201);
      expect(newer.json.version).toBe(2);
      for (const format of formats) {
        const path = `/api/recipes/${saved.json.id}/versions/1/export?format=${format.name}`;
        expect((await call(app, "GET", path, { token: annToken })).status).toBe(404);
        const exported = await app.request(path, {
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(exported.status).toBe(200);
        expect(exported.headers.get("content-disposition")).toContain("attachment;");
        expect(exported.headers.get("content-type")).toContain(
          format.name === "beerxml" ? "application/xml" : "application/json",
        );
        const contents = await exported.text();
        expect(contents).toContain("American IPA");
        const version = format.import(contents).recipe;
        expect(version.name).toBe(draft.name);
        expect(version.styleId).toBe("style-bjcp-2021-21a");
        expect(version.content).toEqual(draft.content);
      }

      const invalid = await call(app, "POST", "/api/recipes/import", {
        body: { format: "beerxml", contents: "<RECIPES>" },
        token: adminToken,
      });
      expect(invalid.status).toBe(400);
      expect(invalid.json.error?.code).toBe("invalid_recipe_file");
      expect(
        (
          await call(app, "GET", `/api/recipes/${saved.json.id}/versions/1/export?format=zip`, {
            token: adminToken,
          })
        ).status,
      ).toBe(400);
    });
  }, 15_000);
});
