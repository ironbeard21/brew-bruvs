// SPDX-License-Identifier: AGPL-3.0-or-later
// Inventory API: items, reservations through a batch's life, low stock, the shopping list, and
// hop alpha acid from reserved lots. Postgres tests need TEST_DATABASE_URL.
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import {
  call,
  type Json,
  offlineDeps,
  TEST_DATABASE_URL,
  type TestApp,
  twoUsers,
  withApp,
} from "./helpers.ts";

const content = {
  schemaVersion: 1,
  efficiencyPct: 72,
  fermentables: [{ name: "Pale malt", kind: "grain", amountKg: 4.5, potentialSg: 1.037 }],
  hops: [{ name: "Cascade", amountKg: 0.028, alphaAcidPct: 5.5, use: "boil", timeMin: 60 }],
  yeasts: [{ name: "US-05", packs: 1, attenuationPct: 78 }],
  miscs: [],
  mash: [],
  fermentation: [],
};
const beer = { name: "House Pale", beverage: "beer", batchSizeL: 20, content };
const code = (r: { json: Json }) => r.json.error?.code;

type Ctx = { app: TestApp; sql: Client; me: string; ann: string };

async function withInventory(run: (ctx: Ctx) => Promise<void>) {
  await withApp({}, async (app, sql) => {
    const { adminToken, annToken } = await twoUsers(app);
    await run({ app, sql, me: adminToken, ann: annToken });
  });
}

async function item(ctx: Ctx, body: object, token = ctx.me) {
  const r = await call(ctx.app, "POST", "/api/inventory", { token, body });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as Json & { id: string };
}

async function plannedBatch(ctx: Ctx, extra: object = {}, token = ctx.me) {
  const recipe = await call(ctx.app, "POST", "/api/recipes", {
    token,
    body: { ...beer, ...extra },
  });
  const batch = await call(ctx.app, "POST", "/api/batches", {
    token,
    body: { recipeId: recipe.json.id, ...extra },
  });
  expect(batch.status).toBe(201);
  return batch.json.id as string;
}

const move = (ctx: Ctx, id: string, status: string, token = ctx.me) =>
  call(ctx.app, "POST", `/api/batches/${id}/status`, { token, body: { status } });

const stockOf = async (ctx: Ctx, id: string) => {
  const r = await call(ctx.app, "GET", `/api/inventory/${id}`, { token: ctx.me });
  return { quantity: r.json.quantity, reserved: r.json.reserved, available: r.json.available };
};

describe("inventory without a database", () => {
  it("needs a session", async () => {
    const app = createApp(offlineDeps());
    expect((await call(app, "GET", "/api/inventory")).status).toBe(401);
    expect((await call(app, "GET", "/api/inventory/shopping-list")).status).toBe(401);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("inventory API on PostgreSQL", () => {
  it("adds, finds, changes and deletes your own items, and hides them from others", async () => {
    await withInventory(async (ctx) => {
      const citra = await item(ctx, {
        name: "Citra",
        catalogId: "hop-citra",
        quantity: 0.454,
        quantityUnit: "kg",
        lot: "L42",
        location: "Freezer",
        alphaAcidPct: 12.5,
        purchasedOn: "2026-11-01",
        bestBefore: "2027-11-01",
        lowStockThreshold: 0.1,
      });
      expect(citra).toMatchObject({
        owner: { type: "user" },
        reserved: 0,
        available: 0.454,
        lot: "L42",
        purchasedOn: "2026-11-01",
      });
      await item(ctx, { name: "Pale malt", quantity: 25, quantityUnit: "kg" });

      const search = async (q: string) =>
        (await call(ctx.app, "GET", `/api/inventory?q=${q}`, { token: ctx.me })).json
          .items as Json[];
      expect((await search("freez")).map((i) => i.name)).toEqual(["Citra"]);
      expect((await search("hop-cit")).map((i) => i.name)).toEqual(["Citra"]);
      expect((await search("%25")).length).toBe(0);
      const all = await call(ctx.app, "GET", "/api/inventory?limit=1", { token: ctx.me });
      expect([(all.json.items as Json[]).length, all.json.nextOffset]).toEqual([1, 1]);
      expect((await call(ctx.app, "GET", "/api/inventory", { token: ctx.ann })).json.items).toEqual(
        [],
      );

      const path = `/api/inventory/${citra.id}`;
      expect((await call(ctx.app, "GET", path, { token: ctx.ann })).status).toBe(404);
      expect(
        (await call(ctx.app, "PATCH", path, { token: ctx.ann, body: { quantity: 1 } })).status,
      ).toBe(404);
      for (const body of [{}, { quantity: -1 }, { alphaAcidPct: 101 }, { quantityUnit: "lb" }]) {
        const r = await call(ctx.app, "PATCH", path, { token: ctx.me, body });
        expect(r.status, JSON.stringify(body)).toBe(400);
      }
      const changed = await call(ctx.app, "PATCH", path, {
        token: ctx.me,
        body: { quantity: 0.2, location: null },
      });
      expect(changed.json).toMatchObject({ quantity: 0.2, location: null });
      expect((await call(ctx.app, "DELETE", path, { token: ctx.ann })).status).toBe(404);
      expect((await call(ctx.app, "DELETE", path, { token: ctx.me })).status).toBe(204);
      expect((await call(ctx.app, "GET", path, { token: ctx.me })).status).toBe(404);
    });
  });

  it("reserves on start, uses on packaging, and gives back when a move is undone", async () => {
    await withInventory(async (ctx) => {
      const malt = await item(ctx, { name: "pale MALT", quantity: 5, quantityUnit: "kg" });
      const hops = await item(ctx, {
        name: "Cascade",
        quantity: 0.02,
        quantityUnit: "kg",
        alphaAcidPct: 7,
      });
      const yeast = await item(ctx, { name: "US-05", quantity: 3, quantityUnit: "each" });
      // A different unit never matches.
      await item(ctx, { name: "Cascade", quantity: 5, quantityUnit: "each" });
      const id = await plannedBatch(ctx);
      expect(
        (await call(ctx.app, "GET", `/api/batches/${id}/reservations`, { token: ctx.me })).json,
      ).toEqual({ items: [] });

      const started = await move(ctx, id, "brewing");
      expect(started.status).toBe(200);
      const change = started.json.inventory as Json;
      expect(change).toMatchObject({ used: false, released: false });
      expect(
        Object.fromEntries((change.reserved as Json[]).map((r) => [r.name, r.quantity])),
      ).toEqual({ "pale MALT": 4.5, Cascade: 0.02, "US-05": 1 });
      expect(change.short).toEqual([
        { name: "Cascade", catalogId: null, unit: "kg", short: expect.closeTo(0.008, 9) },
      ]);
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 5, reserved: 4.5, available: 0.5 });

      // The batch's IBU uses the 7% lot instead of the recipe's 5.5%.
      const stats = await call(ctx.app, "GET", `/api/batches/${id}/stats`, { token: ctx.me });
      expect(stats.json.alphaAcidFromInventory).toEqual([
        { hop: "Cascade", alphaAcidPct: 7, itemId: hops.id },
      ]);
      const batch = await call(ctx.app, "GET", `/api/batches/${id}`, { token: ctx.me });
      const recipe = await call(ctx.app, "GET", `/api/recipes/${(batch.json.recipe as Json).id}`, {
        token: ctx.me,
      });
      const recipeIbu = ((recipe.json.version as Json).stats as Json).ibu as number;
      const batchIbu = (stats.json.stats as Json).ibu as number;
      expect(batchIbu / recipeIbu).toBeCloseTo(7 / 5.5);

      expect((await move(ctx, id, "fermenting")).json.inventory).toBeNull();
      const packaged = await move(ctx, id, "packaged");
      expect(packaged.json.inventory).toMatchObject({ used: true, reserved: [], short: [] });
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 0.5, reserved: 0, available: 0.5 });
      expect(await stockOf(ctx, yeast.id)).toEqual({ quantity: 2, reserved: 0, available: 2 });

      // One step back puts the stock back on the shelf, still reserved.
      await move(ctx, id, "conditioning");
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 5, reserved: 4.5, available: 0.5 });
      await move(ctx, id, "fermenting");
      await move(ctx, id, "brewing");
      const undone = await move(ctx, id, "planned");
      expect(undone.json.inventory).toMatchObject({ released: true });
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 5, reserved: 0, available: 5 });
      const held = await call(ctx.app, "GET", `/api/batches/${id}/reservations`, { token: ctx.me });
      expect(new Set((held.json.items as Json[]).map((r) => r.state))).toEqual(
        new Set(["released"]),
      );
    });
  });

  it("never reserves the same stock twice when two batches start at once", async () => {
    await withInventory(async (ctx) => {
      const malt = await item(ctx, { name: "Pale malt", quantity: 5, quantityUnit: "kg" });
      const first = await plannedBatch(ctx);
      const second = await plannedBatch(ctx);
      // Hold the lot so both starts queue on its lock, then let them through together.
      await ctx.sql.query("BEGIN");
      await ctx.sql.query("SELECT 1 FROM inventory_items WHERE id = $1 FOR UPDATE", [malt.id]);
      const starts = Promise.all([move(ctx, first, "brewing"), move(ctx, second, "brewing")]);
      await new Promise((done) => setTimeout(done, 300));
      await ctx.sql.query("COMMIT");
      const results = await starts;
      // The second start sees the first's 4.5 kg and takes only the 0.5 kg left.
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 5, reserved: 5, available: 0 });
      const shorts = results.map((r) =>
        ((r.json.inventory as Json).short as Json[]).find((s) => s.name === "Pale malt"),
      );
      expect(shorts.filter(Boolean)).toEqual([expect.objectContaining({ short: 4 })]);
    });
  });

  it("puts back on undo exactly what packaging took, after a stock correction", async () => {
    await withInventory(async (ctx) => {
      const malt = await item(ctx, { name: "Pale malt", quantity: 5, quantityUnit: "kg" });
      const id = await plannedBatch(ctx);
      await move(ctx, id, "brewing");
      // Found only 2 kg on the shelf after reserving 4.5.
      await call(ctx.app, "PATCH", `/api/inventory/${malt.id}`, {
        token: ctx.me,
        body: { quantity: 2 },
      });
      await move(ctx, id, "packaged");
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 0, reserved: 0, available: 0 });
      const used = await call(ctx.app, "GET", `/api/batches/${id}/reservations`, { token: ctx.me });
      expect((used.json.items as Json[]).find((r) => r.name === "Pale malt")).toMatchObject({
        quantity: 2,
        state: "used",
      });
      await move(ctx, id, "conditioning");
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 2, reserved: 2, available: 0 });
    });
  });

  it("moves a started batch's reservations to its new owner's inventory", async () => {
    await withInventory(async (ctx) => {
      const brewery = await call(ctx.app, "POST", "/api/breweries", {
        token: ctx.me,
        body: { name: "Hops Co" },
      });
      const breweryId = brewery.json.id as string;
      const mine = await item(ctx, { name: "Pale malt", quantity: 5, quantityUnit: "kg" });
      const theirs = await item(ctx, {
        name: "Pale malt",
        quantity: 10,
        quantityUnit: "kg",
        breweryId,
      });
      const id = await plannedBatch(ctx);
      await move(ctx, id, "brewing");
      expect((await stockOf(ctx, mine.id)).reserved).toBe(4.5);

      const moved = await call(ctx.app, "POST", `/api/batches/${id}/move`, {
        token: ctx.me,
        body: { breweryId },
      });
      expect(moved.status).toBe(200);
      expect((await stockOf(ctx, mine.id)).reserved).toBe(0);
      expect((await stockOf(ctx, theirs.id)).reserved).toBe(4.5);

      await move(ctx, id, "packaged");
      expect((await stockOf(ctx, mine.id)).quantity).toBe(5);
      expect((await stockOf(ctx, theirs.id)).quantity).toBe(5.5);
    });
  });

  it("drops reservations when the batch or the item is deleted", async () => {
    await withInventory(async (ctx) => {
      const malt = await item(ctx, { name: "Pale malt", quantity: 5, quantityUnit: "kg" });
      const id = await plannedBatch(ctx);
      await move(ctx, id, "brewing");
      expect((await stockOf(ctx, malt.id)).reserved).toBe(4.5);
      expect((await call(ctx.app, "DELETE", `/api/batches/${id}`, { token: ctx.me })).status).toBe(
        204,
      );
      expect(await stockOf(ctx, malt.id)).toEqual({ quantity: 5, reserved: 0, available: 5 });

      const again = await plannedBatch(ctx);
      await move(ctx, again, "brewing");
      await call(ctx.app, "DELETE", `/api/inventory/${malt.id}`, { token: ctx.me });
      const held = await call(ctx.app, "GET", `/api/batches/${again}/reservations`, {
        token: ctx.me,
      });
      expect(held.json.items).toEqual([]);
    });
  });

  it("lists low stock and what planned batches are short of", async () => {
    await withInventory(async (ctx) => {
      await item(ctx, { name: "Pale malt", quantity: 5, quantityUnit: "kg" });
      const yeast = await item(ctx, {
        name: "US-05",
        quantity: 1,
        quantityUnit: "each",
        lowStockThreshold: 2,
      });
      await item(ctx, { name: "Gypsum", quantity: 1, quantityUnit: "kg", lowStockThreshold: 0.5 });
      const first = await plannedBatch(ctx);
      const second = await plannedBatch(ctx);

      const low = await call(ctx.app, "GET", "/api/inventory/low-stock", { token: ctx.me });
      expect((low.json.items as Json[]).map((i) => i.id)).toEqual([yeast.id]);

      const list = await call(ctx.app, "GET", "/api/inventory/shopping-list", { token: ctx.me });
      const short = Object.fromEntries(
        (list.json.short as Json[]).map((s) => [s.name, [s.short, (s.batches as Json[]).length]]),
      );
      // 2 × 4.5 kg malt from 5 kg; 2 × 28 g hops from none; 2 packs from 1.
      expect(short["Pale malt"]).toEqual([4, 1]);
      expect(short.Cascade?.[0]).toBeCloseTo(0.056);
      expect(short.Cascade?.[1]).toBe(2);
      expect(short["US-05"]).toEqual([1, 1]);
      expect((list.json.lowStock as Json[]).map((i) => i.name)).toEqual(["US-05"]);

      // Started batches hold their stock and leave the shopping list.
      await move(ctx, first, "brewing");
      await move(ctx, second, "brewing");
      const after = await call(ctx.app, "GET", "/api/inventory/shopping-list", { token: ctx.me });
      expect(after.json.short).toEqual([]);
    });
  });

  it("keeps a brewery's inventory for its members, and brewery batches reserve from it", async () => {
    await withInventory(async (ctx) => {
      const brewery = await call(ctx.app, "POST", "/api/breweries", {
        token: ctx.me,
        body: { name: "Hops Co" },
      });
      const breweryId = brewery.json.id as string;
      const sent = await call(ctx.app, "POST", `/api/breweries/${breweryId}/invites`, {
        token: ctx.me,
        body: { role: "member", email: "ann@brew.test" },
      });
      await call(ctx.app, "POST", "/api/brewery-invites/accept", {
        token: ctx.ann,
        body: { id: sent.json.id },
      });

      const shared = await item(ctx, {
        name: "Pale malt",
        quantity: 10,
        quantityUnit: "kg",
        breweryId,
      });
      expect(shared.owner).toEqual({ type: "brewery", id: breweryId });
      const mine = await item(ctx, { name: "Pale malt", quantity: 10, quantityUnit: "kg" });

      const asMember = await call(ctx.app, "POST", "/api/inventory", {
        token: ctx.ann,
        body: { name: "Oats", quantity: 1, quantityUnit: "kg", breweryId },
      });
      expect(asMember.status).toBe(403);
      const seen = await call(ctx.app, "GET", `/api/inventory?breweryId=${breweryId}`, {
        token: ctx.ann,
      });
      expect((seen.json.items as Json[]).map((i) => i.id)).toEqual([shared.id]);
      const edit = await call(ctx.app, "PATCH", `/api/inventory/${shared.id}`, {
        token: ctx.ann,
        body: { quantity: 0 },
      });
      expect([edit.status, code(edit)]).toEqual([403, "forbidden"]);

      const id = await plannedBatch(ctx, { breweryId });
      await move(ctx, id, "brewing");
      expect((await stockOf(ctx, shared.id)).reserved).toBe(4.5);
      expect((await stockOf(ctx, mine.id)).reserved).toBe(0);

      const outsider = await call(ctx.app, "POST", "/api/auth/signup", {
        body: {
          email: "zed@brew.test",
          password: "zed-password",
          displayName: "Zed",
          inviteCode: (await call(ctx.app, "POST", "/api/invites", { token: ctx.me })).json.code,
          client: "app",
        },
      });
      const denied = await call(
        ctx.app,
        "GET",
        `/api/inventory/shopping-list?breweryId=${breweryId}`,
        {
          token: outsider.json.token as string,
        },
      );
      expect(denied.status).toBe(404);
    });
  });
});
