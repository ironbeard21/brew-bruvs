// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp, OPENAPI_INFO } from "../src/app.ts";
import { RecipeContent, recipeContentJsonSchema } from "../src/contracts/recipe-content.ts";
import { offlineDeps } from "./helpers.ts";

const contract = new URL("../../../packages/api-contract/", import.meta.url);
const fixtures = new URL("fixtures/recipe-content/", contract);
const read = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const files = (sub: string) =>
  readdirSync(new URL(sub, fixtures)).filter((f) => f.endsWith(".json"));

describe("recipe content fixtures", () => {
  it("has one valid recipe for each beverage", () => {
    expect(files("valid/").sort()).toEqual(["beer.json", "cider.json", "mead.json", "wine.json"]);
  });

  it.each(files("valid/"))("valid/%s parses unchanged", (file) => {
    const doc = read(new URL(`valid/${file}`, fixtures));
    const result = RecipeContent.safeParse(doc);
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual(doc);
  });

  it("valid fixtures only use catalog ids that exist in the seed catalog", () => {
    const { catalog } = read(
      new URL("../../packages/catalog-seed/data/catalog.json", contract),
    ) as {
      catalog: Record<string, { id: string }[]>;
    };
    const known = new Set(Object.values(catalog).flatMap((rows) => rows.map((r) => r.id)));
    for (const file of files("valid/")) {
      const doc = read(new URL(`valid/${file}`, fixtures)) as Record<string, unknown>;
      const ids = ["fermentables", "hops", "yeasts", "miscs"].flatMap((k) =>
        (doc[k] as { catalogId?: string }[]).flatMap((line) => line.catalogId ?? []),
      );
      expect(
        ids.filter((id) => !known.has(id)),
        file,
      ).toEqual([]);
    }
  });

  it.each(files("invalid/"))("invalid/%s is rejected at its path", (file) => {
    const { path, content } = read(new URL(`invalid/${file}`, fixtures)) as {
      path: string;
      content: unknown;
    };
    const result = RecipeContent.safeParse(content);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain(path);
  });

  it("free-text lines without a catalog id are fine", () => {
    const doc = read(new URL("valid/beer.json", fixtures));
    doc.hops = doc.hops.map(({ catalogId: _, ...line }: { catalogId?: string }) => line);
    expect(RecipeContent.safeParse(doc).success).toBe(true);
  });
});

describe("published contract", () => {
  it("matches the committed recipe-content.schema.json (run `pnpm api:generate`)", () => {
    expect(recipeContentJsonSchema()).toEqual(
      read(new URL("recipe-content.schema.json", contract)),
    );
  });

  it("is an OpenAPI component with each line type", () => {
    const doc = createApp(offlineDeps()).getOpenAPI31Document(OPENAPI_INFO) as {
      components: { schemas: Record<string, unknown> };
    };
    for (const name of [
      "RecipeContent",
      "FermentableLine",
      "HopLine",
      "YeastLine",
      "MiscLine",
      "MashStep",
      "FermentationStep",
      "RecipeTargets",
    ]) {
      expect(doc.components.schemas[name], name).toBeDefined();
    }
  });
});
