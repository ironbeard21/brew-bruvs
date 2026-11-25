// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { importCatalog } from "@brew-bruvs/catalog-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { BrewfatherImport } from "../src/contracts/brewfather.ts";
import { brewfatherClient } from "../src/integrations/brewfather.ts";
import { call, offlineDeps, TEST_DATABASE_URL, twoUsers, withApp } from "./helpers.ts";

const responses = JSON.parse(
  readFileSync(new URL("./fixtures/brewfather/responses.json", import.meta.url), "utf8"),
) as Record<string, Record<string, unknown>[]>;
const base = "/api/integrations/brewfather";
const credentials = { userId: "fixture-user", apiKey: "fixture-secret" };

it("uses fixed HTTPS endpoints, paginates by the last ID and refuses redirects", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ _id: String(i) }));
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(items))
    .mockResolvedValueOnce(Response.json([{ _id: "50" }]));
  const client = brewfatherClient(credentials, fetcher);
  expect(await client.list("recipes", 250)).toHaveLength(51);
  const next = new URL(String(fetcher.mock.calls[1]?.[0]));
  expect(next.origin).toBe("https://api.brewfather.app");
  expect(next.pathname).toBe("/v2/recipes");
  expect(next.searchParams.get("start_after")).toBe("49");
  expect(next.searchParams.get("complete")).toBe("true");
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    headers: {
      authorization: `Basic ${Buffer.from("fixture-user:fixture-secret").toString("base64")}`,
    },
    redirect: "error",
  });
});

it("returns a generic upstream error when a request fails", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(credentials.apiKey));
  await expect(brewfatherClient(credentials, fetcher).list("recipes", 250)).rejects.toMatchObject({
    status: 502,
    message: "Could not read the Brewfather response",
  });
});

it("requires authentication before an import", async () => {
  const app = createApp(offlineDeps());
  expect((await call(app, "POST", `${base}/preview`, { body: credentials })).status).toBe(401);
  expect((await call(app, "POST", `${base}/import`, { body: {} })).status).toBe(401);
});

describe.skipIf(!TEST_DATABASE_URL)("Brewfather import on PostgreSQL", () => {
  it("previews private drafts and saves reviewed recipes, batch snapshots, readings and stock", async () => {
    const fetchBrewfather = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      const result = responses[url.pathname];
      if (!result) throw new Error(`Unknown fixture route ${url.pathname}`);
      return Response.json(result);
    });
    await withApp({ fetchBrewfather }, async (app, sql) => {
      const { adminToken: token, annToken } = await twoUsers(app);
      await importCatalog(drizzle(sql));
      const preview = await call(app, "POST", `${base}/preview`, { token, body: credentials });
      expect(preview.status).toBe(200);
      expect(preview.res.headers.get("Cache-Control")).toBe("no-store");
      expect(JSON.stringify(preview.json)).not.toContain(credentials.apiKey);
      const data = BrewfatherImport.parse(preview.json);
      expect(data.recipes).toHaveLength(2);
      const library = data.recipes.find((r) => r.ref === "recipe:Library9")?.draft;
      expect(library).toMatchObject({
        visibility: "private",
        credit: {
          sourceUrl: "https://example.test/harvest-pale",
          site: "Harvest Brewery",
          author: "Recipe Author",
        },
        content: {
          fermentables: [{ name: "Local malt blend", amountKg: 4 }],
          hops: [{ catalogId: "hop-columbus", amountKg: 0.02 }],
          mash: [{ tempC: 67, timeMin: 60 }],
          fermentation: [{ stage: "primary", tempC: 19, days: 12 }],
        },
      });
      expect(library?.content.fermentables[0]?.catalogId).toBeUndefined();
      expect(data.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Local malt blend", quantity: 9, quantityUnit: "kg" }),
          expect.objectContaining({ catalogId: "hop-columbus", quantity: 0.1, quantityUnit: "kg" }),
          expect.objectContaining({ name: "US-05", quantity: 2, quantityUnit: "each" }),
          expect.objectContaining({
            name: "House water adjustment",
            quantity: 0.25,
            quantityUnit: "l",
          }),
        ]),
      );
      expect((await sql.query("SELECT count(*) FROM recipes")).rows[0]?.count).toBe("0");
      expect(
        (
          await call(app, "POST", `${base}/import`, {
            token,
            body: { ...data, recipes: [] },
          })
        ).status,
      ).toBe(400);
      const saved = await call(app, "POST", `${base}/import`, { token, body: data });
      expect(saved.status).toBe(201);
      expect(fetchBrewfather).toHaveBeenCalledTimes(7);
      const recipeId = (saved.json.recipeIds as string[])[0];
      const recipe = await call(app, "GET", `/api/recipes/${recipeId}`, { token });
      expect(recipe.json).toMatchObject({
        visibility: "private",
        credit: {
          sourceUrl: "https://example.test/harvest-pale",
          site: "Harvest Brewery",
          author: "Recipe Author",
        },
      });
      expect((await call(app, "GET", `/api/recipes/${recipeId}`, { token: annToken })).status).toBe(
        404,
      );
      const batchId = (saved.json.batchIds as string[])[0];
      const batch = await call(app, "GET", `/api/batches/${batchId}`, { token });
      expect(batch.json).toMatchObject({
        name: "Batch 17",
        status: "finished",
        batchSizeL: 19.5,
        recipe: { id: (saved.json.recipeIds as string[])[1] },
      });
      const readings = await call(app, "GET", `/api/batches/${batchId}/readings`, { token });
      expect(readings.json).toMatchObject([
        {
          gravitySg: 1.039,
          temperatureC: 5.1,
          source: "device",
          takenAt: "2019-10-29T21:11:40.131Z",
        },
        { temperatureC: 5, source: "manual", note: "Temperature check" },
      ]);
      expect((await sql.query("SELECT count(*) FROM inventory_reservations")).rows[0]?.count).toBe(
        "0",
      );
      const stock = await sql.query("SELECT quantity FROM inventory_items WHERE name = 'Columbus'");
      expect(stock.rows[0]?.quantity).toBe(0.1);
      const integrations = await sql.query("SELECT count(*) FROM integrations");
      expect(integrations.rows[0]?.count).toBe("0");
    });
  }, 20_000);
});
