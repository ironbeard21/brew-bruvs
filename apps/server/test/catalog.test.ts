// SPDX-License-Identifier: AGPL-3.0-or-later
import { importCatalog } from "@brew-bruvs/catalog-seed";
import { z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { CatalogAttribution, CatalogItem, CatalogPage } from "../src/contracts/catalog.ts";
import { offlineDeps, TEST_DATABASE_URL, type TestApp, withApp } from "./helpers.ts";

const base = "/api/catalog";

async function signInAsBrewer(app: TestApp) {
  const account = (name: string) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `${name}@example.test`,
      displayName: name,
      password: "catalog-test-password",
      client: "app",
    }),
  });
  expect((await app.request("/api/setup", account("admin"))).status).toBe(201);
  const signedIn = await app.request("/api/auth/signup", account("brewer"));
  expect(signedIn.status).toBe(201);
  const { token, user } = z
    .object({ token: z.string(), user: z.object({ isAdmin: z.boolean() }) })
    .parse(await signedIn.json());
  expect(user.isAdmin).toBe(false);

  return (path: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } });
}

it.each([`${base}/hops`, `${base}/hops/hop-columbus`, `${base}/sources`])(
  "requires a session for %s",
  async (path) => {
    const response = await createApp(offlineDeps()).request(path);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  },
);

it("documents the catalog routes and their read permissions in OpenAPI", async () => {
  const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
  const response = await createApp(offlineDeps()).request("/api/openapi.json");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    paths: {
      "/api/catalog/{catalog}": {
        get: {
          security,
          parameters: expect.arrayContaining([
            expect.objectContaining({
              name: "offset",
              schema: expect.objectContaining({ type: "integer", default: 0 }),
            }),
          ]),
        },
      },
      "/api/catalog/{catalog}/{id}": { get: { security } },
      "/api/catalog/sources": { get: { security } },
    },
  });
});

describe.skipIf(!TEST_DATABASE_URL)("catalog API on PostgreSQL", () => {
  it("searches each catalog by name or alias and pages in a stable order", async () => {
    await withApp({ signupMode: "open" }, async (app, client) => {
      await importCatalog(drizzle(client));
      const get = await signInAsBrewer(app);
      for (const [catalog, query, id] of [
        ["hops", " zEuS ", "hop-columbus"],
        ["fermentables", "Alfalfa Honey", "ferm-alfalfa-honey"],
        ["yeasts", "California Ale Yeast", "yeast-white-labs-wlp001"],
        ["miscs", "Acid Blend", "misc-acid-blend"],
        ["styles", "American IPA", "style-bjcp-2021-21a"],
        ["water_profiles", "Balanced Profile", "water-balanced-profile"],
        ["equipment", "All Grain", "equip-5-5-gal-all-grain-10-gal-igloo-cooler"],
      ] as const) {
        const response = await get(`${base}/${catalog}?q=${encodeURIComponent(query)}`);
        expect(response.status).toBe(200);
        expect(CatalogPage.parse(await response.json()).items).toContainEqual(
          expect.objectContaining({ id, catalog }),
        );
      }

      const first = CatalogPage.parse(await (await get(`${base}/hops?limit=1`)).json());
      const second = CatalogPage.parse(
        await (await get(`${base}/hops?limit=1&offset=${first.nextOffset}`)).json(),
      );
      const combined = CatalogPage.parse(await (await get(`${base}/hops?limit=2`)).json());
      expect(first.nextOffset).toBe(1);
      expect(second.nextOffset).toBe(2);
      expect(combined.items).toEqual([...first.items, ...second.items]);
      expect(first.items[0]?.id).not.toBe(second.items[0]?.id);

      const finalPage = CatalogPage.parse(await (await get(`${base}/hops?offset=493`)).json());
      expect(finalPage.items).toHaveLength(1);
      expect(finalPage.nextOffset).toBeNull();
      expect(await (await get(`${base}/hops?q=%25`)).json()).toEqual({
        items: [],
        nextOffset: null,
      });
    });
  }, 15_000);

  it("returns item details, licenses and credited sources", async () => {
    await withApp({ signupMode: "open" }, async (app, client) => {
      await importCatalog(drizzle(client));
      const get = await signInAsBrewer(app);
      const detail = await get(`${base}/hops/hop-columbus`);
      expect(detail.status).toBe(200);
      const item = CatalogItem.parse(await detail.json());
      expect(item).toMatchObject({
        id: "hop-columbus",
        catalog: "hops",
        alphaAcidPct: 16,
        aliases: expect.arrayContaining(["Zeus"]),
        sources: expect.arrayContaining(["bt003", "wallbrew"]),
        licenses: expect.arrayContaining(["GPL-3.0", "MIT"]),
      });
      const response = await get(`${base}/sources`);
      expect(response.status).toBe(200);
      const { attribution, sources } = CatalogAttribution.parse(await response.json());
      expect(attribution).toContain("# Attribution");
      expect(attribution).toContain("Wall Brew Co");
      expect(sources.wallbrew).toMatchObject({
        license: "MIT",
        commit: expect.stringMatching(/^[a-f0-9]{40}$/),
      });
      expect(sources.starter?.commit).toBeNull();
      expect(sources.bt003y).toBeUndefined();
      for (const source of item.sources) expect(sources[source]).toBeDefined();

      const missing = await get(`${base}/hops/hop-does-not-exist`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ error: { code: "not_found" } });
    });
  }, 15_000);

  it("rejects invalid catalog, item and pagination inputs", async () => {
    await withApp({ signupMode: "open" }, async (app) => {
      const get = await signInAsBrewer(app);
      for (const path of [
        "/unknown",
        "/unknown/item",
        "/hops/invalid%20id",
        "/hops?limit=0",
        "/hops?limit=101",
        "/hops?limit=0x10",
        "/hops?offset=",
        "/hops?offset=-1",
        "/hops?offset=1.5",
        "/hops?q=%20",
        "/sources?limit=1",
      ]) {
        const response = await get(`${base}${path}`);
        expect(response.status, path).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: "validation_error" } });
      }
    });
  }, 15_000);
});
