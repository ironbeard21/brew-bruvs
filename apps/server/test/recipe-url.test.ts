// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { importCatalog } from "@brew-bruvs/catalog-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { ImportedRecipeDraft } from "../src/contracts/recipe-file.ts";
import { importRecipePage } from "../src/importers/recipe-page.ts";
import { createRemoteRecipeReader } from "../src/importers/remote-recipe.ts";
import { call, offlineDeps, setupAdmin, TEST_DATABASE_URL, withApp } from "./helpers.ts";

const read = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
const source = "https://recipes.example.test/recipe";
const page = (body = read("recipe-pages/schema.html"), url = source) => ({
  url: new URL(url),
  body,
});
const html = (body: string) => ({ status: 200, mediaType: "text/html", body });
const missing = { status: 404, body: "" };
const publicDns = [{ address: "93.184.216.34", family: 4 }];
type Reply = { status: number; location?: string; body: string; mediaType?: string };

function fixtures(responses: Record<string, Reply>, addresses = publicDns, deadline?: number) {
  const resolve = vi.fn(async (_host: string) => addresses);
  const request = vi.fn(async (url: URL, _address: unknown, _maxBytes: number) => {
    const response = responses[url.href];
    if (!response) throw new Error(`Unexpected fixture URL ${url.href}`);
    return response;
  });
  const readUrl = createRemoteRecipeReader({ resolve, request }, deadline);
  return { resolve, request, readUrl };
}

it("copies schema.org ingredients, measures, steps and targets with a bounded excerpt", async () => {
  const attachment = vi.fn();
  const { recipe, excerpt } = await importRecipePage(page(), attachment);
  expect(attachment).not.toHaveBeenCalled();
  expect(recipe).toMatchObject({
    name: "Harbor & Hill Pale",
    beverage: "beer",
    credit: {
      sourceUrl: source,
      site: "Fixture Brewing",
      author: "Robin Brewer",
      license: "https://example.test/license",
    },
    content: {
      fermentables: [{ name: "Pale Malt" }],
      hops: [{ name: "Zeus", use: "boil", timeMin: 60 }],
      yeasts: [{ name: "US-05", packs: 1 }],
      targets: { og: 1.052, ibu: 40 },
    },
  });
  expect(recipe.batchSizeL).toBeCloseTo(18.927);
  expect(recipe.content.fermentables[0]?.amountKg).toBeCloseTo(0.680388555);
  expect(recipe.content.notes).toContain("1. Mash the malt.\n2. Add the hops & boil.");
  expect(recipe.content.notes).toContain("2 pinches House clarifier");
  expect(recipe.content.notes).not.toMatch(/outside the excerpt|editorial prose|photo.jpg/);
  expect(excerpt.length).toBeLessThanOrEqual(240);
});

it("takes hop times and yeast from the steps when the ingredient lines leave them out", async () => {
  const { recipe } = await importRecipePage(page(read("recipe-pages/hops-in-steps.html")), vi.fn());
  expect(recipe.content).toMatchObject({
    fermentables: [
      { name: "Pale 2-Row", kind: "grain" },
      { name: "Caramel / Crystal 40L", kind: "grain" },
    ],
    hops: [
      { name: "Magnum", use: "boil", timeMin: 60 },
      { name: "Cascade", use: "boil", timeMin: 10 },
      { name: "Cascade", use: "boil", timeMin: 0 },
      { name: "Cascade", use: "dry_hop" },
    ],
    yeasts: [{ name: "Fermentis Safale - American Ale Yeast US-05" }],
  });
  expect(recipe.content.hops[3]?.amountKg).toBeCloseTo(0.056699);
  expect(recipe.content.notes).toContain("Ingredients to review\n5 g Gypsum");
  expect(recipe.content.notes).not.toMatch(/Ingredients to review[\s\S]*(?:2-Row|Cascade)/);
});

it("uses linked BeerJSON before schema.org and takes credit from the page", async () => {
  const attachment = vi.fn(async () => read("recipe-files/external.json"));
  const { recipe } = await importRecipePage(page(read("recipe-pages/linked.html")), attachment);
  expect(attachment).toHaveBeenCalledExactlyOnceWith("/downloads/recipe.json");
  expect(recipe.beverage).toBe("cider");
  expect(recipe.credit).toMatchObject({ sourceUrl: source, author: "Page Brewer" });
});

it("falls back to schema.org when a linked file cannot be parsed", async () => {
  const { recipe } = await importRecipePage(
    page(read("recipe-pages/linked.html")),
    async () => "bad",
  );
  expect(recipe.name).toBe("Fallback recipe");
});

it("recognizes the labeled Brewer's Friend BeerXML export link", async () => {
  const attachment = vi.fn(async () => read("recipe-files/external.xml"));
  const { recipe } = await importRecipePage(
    page(
      read("recipe-pages/brewers-friend.html"),
      "https://www.brewersfriend.com/homebrew/recipe/view/103",
    ),
    attachment,
  );
  expect(attachment).toHaveBeenCalledExactlyOnceWith("/export/recipe/103");
  expect(recipe).toMatchObject({
    name: "Harbor Pale & Unusual",
    credit: { site: "Brewer's Friend" },
  });
});

it("requires a real batch volume when the page only lists servings", async () => {
  const body =
    '<script type="application/ld+json">{"@type":"Recipe","name":"Test","recipeYield":"4 servings"}</script>';
  await expect(importRecipePage(page(body), vi.fn())).rejects.toThrow("batch size");
  const { recipe } = await importRecipePage(page(body), vi.fn(), 12);
  expect(recipe.batchSizeL).toBe(12);
});

it("fetches one HTML page with a pinned address and checks the linked origin's robots rules", async () => {
  const { readUrl, request } = fixtures({
    "https://recipes.example.test/robots.txt": missing,
    [source]: html(
      read("recipe-pages/linked.html").replace(
        "/downloads/recipe.json",
        "https://files.example.test/recipe.beerjson",
      ),
    ),
    "https://files.example.test/robots.txt": missing,
    "https://files.example.test/recipe.beerjson": {
      status: 200,
      body: read("recipe-files/external.json"),
    },
  });
  expect((await readUrl(source, importRecipePage)).recipe.beverage).toBe("cider");
  expect(request.mock.calls.map(([url]) => url.href)).toEqual([
    "https://recipes.example.test/robots.txt",
    source,
    "https://files.example.test/robots.txt",
    "https://files.example.test/recipe.beerjson",
  ]);
  expect(request.mock.calls.every(([, address]) => address === publicDns[0])).toBe(true);
  expect(request.mock.calls.map(([, , limit]) => limit)).toEqual([
    524288, 2097152, 524288, 8388608,
  ]);
});

it("keeps only the page excerpt, not a linked file's description", async () => {
  const story = "The full write-up from the original author. ".repeat(200);
  const xml = read("recipe-files/external.xml").replace(
    "<VERSION>1</VERSION>",
    `<VERSION>1</VERSION><NOTES>${story}</NOTES>`,
  );
  const linked = page(
    '<html><head><meta name="description" content="A short blurb"></head><body><a href="/r.xml">BeerXML</a></body></html>',
  );
  const { recipe, excerpt } = await importRecipePage(linked, async () => xml);
  expect(excerpt).toBe("A short blurb");
  expect(recipe.content.notes).toBe("Source excerpt\nA short blurb");
});

it("honors a user-agent rule before fetching the page", async () => {
  const { readUrl, request } = fixtures({
    "https://recipes.example.test/robots.txt": {
      status: 200,
      body: "User-agent: BrewBruvs\nDisallow: /recipe\n",
    },
  });
  await expect(readUrl(source, vi.fn())).rejects.toThrow("disallows");
  expect(request.mock.calls.map(([url]) => url.pathname)).toEqual(["/robots.txt"]);
});

it("refuses private and mixed DNS answers before opening a connection", async () => {
  const { readUrl, request } = fixtures({}, [...publicDns, { address: "192.168.1.2", family: 4 }]);
  await expect(readUrl(source, vi.fn())).rejects.toThrow("public recipe URL");
  expect(request).not.toHaveBeenCalled();
});

it.each(["127.0.0.1", "[::1]", "[::ffff:127.0.0.1]", "169.254.169.254", "host.local"])(
  "does not send requests to %s after a redirect",
  async (host) => {
    const { readUrl, request } = fixtures({
      "https://recipes.example.test/robots.txt": missing,
      [source]: { status: 302, location: `http://${host}/recipe`, body: "" },
    });
    await expect(readUrl(source, vi.fn())).rejects.toThrow("public recipe URL");
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it("enforces the deadline while resolving a hostname", async () => {
  const testTimer = setTimeout(() => {}, 100);
  const request = vi.fn();
  const readUrl = createRemoteRecipeReader({ resolve: () => new Promise(() => {}), request }, 10);
  try {
    await expect(readUrl(source, vi.fn())).rejects.toThrow("within the import limits");
    expect(request).not.toHaveBeenCalled();
  } finally {
    clearTimeout(testTimer);
  }
});

it("requires a session before processing an import URL", async () => {
  const result = await call(createApp(offlineDeps()), "POST", "/api/recipes/import-url", {
    body: { url: source },
  });
  expect(result.status).toBe(401);
});

describe.skipIf(!TEST_DATABASE_URL)("recipe URL API on PostgreSQL", () => {
  it("returns a private preview and saves permanent credit on confirmation", async () => {
    const { readUrl, request } = fixtures({
      "https://recipes.example.test/robots.txt": missing,
      [source]: html(page().body),
    });
    await withApp({ readRecipeUrl: readUrl }, async (app, sql) => {
      const token = await setupAdmin(app);
      await importCatalog(drizzle(sql));

      const invalid = await call(app, "POST", "/api/recipes/import-url", {
        token,
        body: { url: "file:///tmp/recipe.html" },
      });
      expect(invalid.status).toBe(400);
      expect(request).not.toHaveBeenCalled();

      const preview = await call(app, "POST", "/api/recipes/import-url", {
        token,
        body: { url: source },
      });
      expect(preview.status).toBe(200);
      const draft = ImportedRecipeDraft.parse(preview.json.draft);
      expect(draft.content.hops[0]?.catalogId).toBe("hop-columbus");
      expect(draft.visibility).toBe("private");
      expect((await sql.query("SELECT count(*) FROM recipes")).rows[0]?.count).toBe("0");

      const saved = await call(app, "POST", "/api/recipes", { token, body: draft });
      expect(saved.status).toBe(201);
      expect(saved.json).toMatchObject({
        visibility: "private",
        credit: {
          sourceUrl: source,
          site: "Fixture Brewing",
          author: "Robin Brewer",
          license: "https://example.test/license",
          importedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      });
      const changed = await call(app, "PATCH", `/api/recipes/${saved.json.id}`, {
        token,
        body: { credit: { sourceUrl: "https://elsewhere.test/" } },
      });
      expect(changed.status).toBe(400);
    });
  }, 15_000);
});
