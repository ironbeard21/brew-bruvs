// SPDX-License-Identifier: AGPL-3.0-or-later
// Batches API: status moves, the mead nutrient schedule, readings, reminders and notes.
// Postgres tests need TEST_DATABASE_URL.
import { NUTRIENT_NITROGEN_FRACTION, nutrientPlan, recipeStats } from "@brew-bruvs/brew-math";
import { schema } from "@brew-bruvs/db";
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

const empty = { miscs: [], mash: [], fermentation: [] };
const beerContent = {
  schemaVersion: 1,
  efficiencyPct: 72,
  fermentables: [{ name: "Pale malt", kind: "grain", amountKg: 4.5, potentialSg: 1.037 }],
  hops: [{ name: "Cascade", amountKg: 0.028, alphaAcidPct: 5.5, use: "boil", timeMin: 60 }],
  yeasts: [{ name: "US-05", attenuationPct: 78 }],
  ...empty,
};
const meadContent = {
  schemaVersion: 1,
  fermentables: [{ name: "Wildflower honey", kind: "honey", amountKg: 4.4, potentialSg: 1.035 }],
  hops: [],
  yeasts: [{ name: "71B", attenuationPct: 100 }],
  ...empty,
};
const beer = { name: "House Pale", beverage: "beer", batchSizeL: 20, content: beerContent };
const mead = { name: "Traditional", beverage: "mead", batchSizeL: 19, content: meadContent };

type Ctx = { app: TestApp; sql: Client; owner: string; ann: string; annId: string };

async function withBatches(run: (ctx: Ctx) => Promise<void>) {
  await withApp({}, async (app, sql) => {
    const { adminToken, annToken, annId } = await twoUsers(app);
    await run({ app, sql, owner: adminToken, ann: annToken, annId });
  });
}

const code = (r: { json: Json }) => r.json.error?.code;

async function recipe(ctx: Ctx, body: object = beer) {
  const r = await call(ctx.app, "POST", "/api/recipes", { token: ctx.owner, body });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

async function batch(ctx: Ctx, recipeId: string, extra: object = {}) {
  const r = await call(ctx.app, "POST", "/api/batches", {
    token: ctx.owner,
    body: { recipeId, ...extra },
  });
  expect(r.status).toBe(201);
  return r.json as Json & { id: string };
}

const move = (ctx: Ctx, id: string, status: string, token = ctx.owner) =>
  call(ctx.app, "POST", `/api/batches/${id}/status`, { token, body: { status } });

/** Batches have no visibility route yet; tests set it directly. */
const makeServerVisible = (ctx: Ctx, table: string, id: string) =>
  ctx.sql.query(`UPDATE ${table} SET visibility = 'server' WHERE id = $1`, [id]);

describe("batches API without a database", () => {
  it("needs a session to write", async () => {
    const app = createApp(offlineDeps());
    const id = crypto.randomUUID();
    for (const [method, path, body] of [
      ["POST", "/api/batches", { recipeId: id }],
      ["GET", "/api/reminders", undefined],
      ["POST", "/api/notes", { body: "Hi" }],
    ] as const) {
      expect((await call(app, method, path, { body })).status, path).toBe(401);
    }
  });

  it("documents every batch, reminder and note route", async () => {
    const r = await call(createApp(offlineDeps()), "GET", "/api/openapi.json");
    expect(Object.keys(r.json.paths as object)).toEqual(
      expect.arrayContaining([
        "/api/batches",
        "/api/batches/{id}",
        "/api/batches/{id}/status",
        "/api/batches/{id}/readings",
        "/api/batches/{id}/readings/{readingId}",
        "/api/batches/{id}/reminders",
        "/api/reminders",
        "/api/reminders/{id}/done",
        "/api/notes",
        "/api/notes/{id}",
      ]),
    );
  });
});

describe.skipIf(!TEST_DATABASE_URL)("batches API on Postgres (TEST_DATABASE_URL)", () => {
  it("starts a batch from a recipe version you can read", async () => {
    await withBatches(async (ctx) => {
      const recipeId = await recipe(ctx);
      await call(ctx.app, "POST", `/api/recipes/${recipeId}/versions`, {
        token: ctx.owner,
        body: { name: "House Pale v2", batchSizeL: 23, content: beerContent },
      });

      const latest = await batch(ctx, recipeId);
      expect(latest).toMatchObject({
        name: "House Pale v2",
        beverage: "beer",
        status: "planned",
        visibility: "private",
        recipe: { id: recipeId, version: 2 },
        batchSizeL: 23,
        brewedAt: null,
        statusHistory: [{ status: "planned" }],
        allowedStatuses: schema.BEER_STATUSES.slice(1),
        uri: `http://brew.test/batches/${latest.id}`,
      });
      const first = await batch(ctx, recipeId, { version: 1, name: "Brew day 1", batchSizeL: 10 });
      expect(first).toMatchObject({ name: "Brew day 1", recipe: { version: 1 }, batchSizeL: 10 });

      const create = (body: object, token: string | undefined = ctx.owner) =>
        call(ctx.app, "POST", "/api/batches", { token, body });
      expect((await create({ recipeId, version: 9 })).status).toBe(404);
      expect((await create({ recipeId: crypto.randomUUID() })).status).toBe(404);
      expect((await create({ recipeId: "nope" })).status).toBe(400);
      expect((await create({ recipeId, batchSizeL: 0 })).status).toBe(400);
      expect(code(await create({ recipeId, equipmentProfileId: crypto.randomUUID() }))).toBe(
        "unknown_equipment_profile",
      );
      // Ann can't brew a private recipe; once it's visible to her she can, and it's hers.
      expect((await create({ recipeId }, ctx.ann)).status).toBe(404);
      await makeServerVisible(ctx, "recipes", recipeId);
      const hers = await create({ recipeId }, ctx.ann);
      expect(hers.status).toBe(201);
      expect(hers.json.owner).toEqual({ type: "user", id: ctx.annId });

      // A recipe with batches can't be deleted.
      const del = await call(ctx.app, "DELETE", `/api/recipes/${recipeId}`, { token: ctx.owner });
      expect(code(del)).toBe("recipe_in_use");
    });
  });

  it("moves forward (skipping is fine) or one step back, and keeps the history", async () => {
    await withBatches(async (ctx) => {
      const { id } = await batch(ctx, await recipe(ctx));
      const brewing = await move(ctx, id, "brewing");
      expect(brewing.status).toBe(200);
      const brewedAt = (brewing.json.batch as Json).brewedAt;
      expect(brewedAt).toEqual(expect.any(String));
      expect(brewing.json).toMatchObject({ addedReminders: [], scheduleError: null });

      expect((await move(ctx, id, "fermenting")).status).toBe(200);
      // Skip conditioning.
      expect((await move(ctx, id, "packaged")).status).toBe(200);
      for (const bad of ["fermenting", "packaged", "planned", "primary"]) {
        const r = await move(ctx, id, bad);
        expect(r.status, bad).toBe(409);
        expect(code(r)).toBe("invalid_status_move");
      }
      expect((await move(ctx, id, "conditioning")).status).toBe(200);
      const finished = await move(ctx, id, "finished");
      expect(finished.json.batch).toMatchObject({
        status: "finished",
        completedAt: expect.any(String),
        brewedAt,
        allowedStatuses: ["packaged"],
      });
      const undone = await move(ctx, id, "packaged");
      expect(undone.json.batch).toMatchObject({ completedAt: null });

      const detail = await call(ctx.app, "GET", `/api/batches/${id}`, { token: ctx.owner });
      expect((detail.json.statusHistory as Json[]).map((h) => h.status)).toEqual([
        "planned",
        "brewing",
        "fermenting",
        "packaged",
        "conditioning",
        "finished",
        "packaged",
      ]);
      expect((await move(ctx, id, "bottled")).status).toBe(409);
      expect((await move(ctx, id, "boiling")).status).toBe(400);

      // Permissions: invisible is not found, visible but not editable is forbidden.
      expect((await move(ctx, id, "finished", ctx.ann)).status).toBe(404);
      expect((await call(ctx.app, "GET", `/api/batches/${id}`, { token: ctx.ann })).status).toBe(
        404,
      );
      await makeServerVisible(ctx, "batches", id);
      expect((await call(ctx.app, "GET", `/api/batches/${id}`, { token: ctx.ann })).status).toBe(
        200,
      );
      expect((await move(ctx, id, "finished", ctx.ann)).status).toBe(403);
    });
  });

  it("lists batches you can read, filtered by status or to your own", async () => {
    await withBatches(async (ctx) => {
      const recipeId = await recipe(ctx);
      const a = await batch(ctx, recipeId);
      const b = await batch(ctx, recipeId);
      await move(ctx, b.id, "brewing");
      const ids = async (token: string | undefined, query = "") =>
        ((await call(ctx.app, "GET", `/api/batches${query}`, { token })).json.items as Json[]).map(
          (x) => x.id,
        );
      expect(await ids(ctx.owner)).toEqual([b.id, a.id]);
      expect(await ids(ctx.owner, "?status=brewing")).toEqual([b.id]);
      expect(await ids(ctx.owner, "?limit=1&offset=1")).toEqual([a.id]);
      expect(await ids(ctx.ann)).toEqual([]);
      await makeServerVisible(ctx, "batches", a.id);
      expect(await ids(ctx.ann)).toEqual([a.id]);
      expect(await ids(ctx.ann, "?mine=true")).toEqual([]);
      expect(await ids(undefined)).toEqual([]);
      expect((await call(ctx.app, "GET", "/api/batches?mine=true")).status).toBe(401);
      expect((await call(ctx.app, "GET", "/api/batches?status=boiling")).status).toBe(400);
    });
  });

  it("schedules a mead's nutrients from brew-math when it moves to primary, once", async () => {
    await withBatches(async (ctx) => {
      const { id } = await batch(ctx, await recipe(ctx, mead));
      const stats = recipeStats({
        volumeL: 19,
        efficiencyPct: 72,
        fermentables: [{ kg: 4.4, potentialSg: 1.035, mashed: false }],
        attenuationPct: 100,
        hops: [],
      });
      if (!stats.ok) throw new Error("stats");
      const plan = nutrientPlan({
        volumeL: 19,
        og: stats.value.og,
        expectedFg: stats.value.fg,
        need: "medium",
        nitrogenFraction: NUTRIENT_NITROGEN_FRACTION["fermaid-k"],
      });
      if (!plan.ok) throw new Error("plan");
      const grams = `${(plan.value.totalGrams / 2).toFixed(1)} g Fermaid-K`;

      const r = await move(ctx, id, "primary");
      expect(r.status).toBe(200);
      expect(r.json.scheduleError).toBeNull();
      const added = r.json.addedReminders as Json[];
      expect(added).toHaveLength(2);
      const pitched = Date.parse((r.json.batch as Json).brewedAt as string);
      expect(added.map((x) => (Date.parse(x.dueAt as string) - pitched) / 3_600_000)).toEqual([
        24, 72,
      ]);
      expect(added[0]).toMatchObject({ kind: "nutrient", note: expect.stringContaining(grams) });
      expect(added[1]?.note).toContain(`SG ${plan.value.oneThirdBreakSg.toFixed(3)}`);

      // Undo and redo the move: no second schedule.
      await move(ctx, id, "planned");
      expect((await move(ctx, id, "primary")).json.addedReminders).toEqual([]);
      const all = await call(ctx.app, "GET", `/api/batches/${id}/reminders`, { token: ctx.owner });
      expect(all.json).toHaveLength(2);

      // A recipe that lists DAP gets DAP doses.
      const dap = await batch(
        ctx,
        await recipe(ctx, {
          ...mead,
          content: {
            ...meadContent,
            miscs: [{ name: "DAP", kind: "nutrient", amountKg: 0.005, use: "primary" }],
          },
        }),
      );
      const dapMove = await move(ctx, dap.id, "primary");
      expect((dapMove.json.addedReminders as Json[])[0]?.note).toMatch(/g DAP/);

      // Without stats there is no schedule, but the move still happens.
      const unknown = await batch(
        ctx,
        await recipe(ctx, { ...mead, content: { ...meadContent, yeasts: [] } }),
      );
      const noStats = await move(ctx, unknown.id, "primary");
      expect(noStats.status).toBe(200);
      expect(noStats.json).toMatchObject({
        addedReminders: [],
        scheduleError: expect.stringMatching(/yeast/),
        batch: { status: "primary" },
      });
      // Wine and cider don't get one.
      const wine = await batch(ctx, await recipe(ctx, { ...mead, beverage: "wine" }));
      expect((await move(ctx, wine.id, "primary")).json.addedReminders).toEqual([]);
    });
  });

  it("adds, corrects, lists in time order and deletes readings", async () => {
    await withBatches(async (ctx) => {
      const { id } = await batch(ctx, await recipe(ctx, mead));
      const path = `/api/batches/${id}/readings`;
      const add = (body: object, token = ctx.owner) => call(ctx.app, "POST", path, { token, body });

      const full = await add({
        takenAt: "2026-11-20T10:00:00Z",
        gravitySg: 1.1,
        temperatureC: 19.5,
        ph: 3.6,
        brix: 24.5,
        titratableAcidityGPerL: 6.5,
        freeSo2MgPerL: 30,
        source: "device",
        note: "Pitched",
      });
      expect(full.status).toBe(201);
      expect(full.json).toMatchObject({ gravitySg: 1.1, freeSo2MgPerL: 30, source: "device" });
      const earlier = await add({ takenAt: "2026-11-19T10:00:00+02:00", gravitySg: 1.102 });
      expect(earlier.json).toMatchObject({ source: "manual", ph: null });

      const list = await call(ctx.app, "GET", path, { token: ctx.owner });
      expect((list.json as unknown as Json[]).map((x) => x.id)).toEqual([
        earlier.json.id,
        full.json.id,
      ]);

      expect((await add({ takenAt: "2026-11-21T10:00:00Z" })).status).toBe(400);
      expect((await add({ takenAt: "2026-11-21T10:00:00Z", gravitySg: 2 })).status).toBe(400);
      expect((await add({ takenAt: "yesterday", gravitySg: 1.05 })).status).toBe(400);

      const one = `${path}/${full.json.id}`;
      const patched = await call(ctx.app, "PATCH", one, {
        token: ctx.owner,
        body: { temperatureC: null, ph: 3.4 },
      });
      expect(patched.json).toMatchObject({ temperatureC: null, ph: 3.4, gravitySg: 1.1 });
      const empty = await call(ctx.app, "PATCH", `${path}/${earlier.json.id}`, {
        token: ctx.owner,
        body: { gravitySg: null },
      });
      expect(empty.status).toBe(400);
      const other = await batch(ctx, await recipe(ctx));
      const wrongBatch = `/api/batches/${other.id}/readings/${full.json.id}`;
      expect(
        (await call(ctx.app, "PATCH", wrongBatch, { token: ctx.owner, body: {} })).status,
      ).toBe(404);

      // Ann: can't see it, then can see but not change it.
      expect((await call(ctx.app, "GET", path, { token: ctx.ann })).status).toBe(404);
      expect((await add({ takenAt: "2026-11-21T10:00:00Z", ph: 3 }, ctx.ann)).status).toBe(404);
      await makeServerVisible(ctx, "batches", id);
      expect((await call(ctx.app, "GET", path, { token: ctx.ann })).status).toBe(200);
      expect((await add({ takenAt: "2026-11-21T10:00:00Z", ph: 3 }, ctx.ann)).status).toBe(403);
      expect((await call(ctx.app, "DELETE", one, { token: ctx.ann })).status).toBe(403);

      expect((await call(ctx.app, "DELETE", one, { token: ctx.owner })).status).toBe(204);
      expect((await call(ctx.app, "DELETE", one, { token: ctx.owner })).status).toBe(404);
    });
  });

  it("adds reminders, lists what's due across your batches and marks them done", async () => {
    await withBatches(async (ctx) => {
      const { id } = await batch(ctx, await recipe(ctx));
      const add = (body: object, token = ctx.owner) =>
        call(ctx.app, "POST", `/api/batches/${id}/reminders`, { token, body });
      const past = await add({ kind: "rack", dueAt: "2026-01-01T00:00:00Z", note: "Rack it" });
      expect(past.status).toBe(201);
      expect(past.json).toMatchObject({ kind: "rack", batchName: "House Pale", doneAt: null });
      const future = await add({ kind: "taste", dueAt: "2099-01-01T00:00:00Z" });
      expect((await add({ kind: "party", dueAt: "2026-01-01T00:00:00Z" })).status).toBe(400);

      const due = async (token: string, query = "") =>
        (
          (await call(ctx.app, "GET", `/api/reminders${query}`, { token }))
            .json as unknown as Json[]
        ).map((r) => r.id);
      expect(await due(ctx.owner)).toEqual([past.json.id]);
      expect(await due(ctx.owner, "?until=2100-01-01T00:00:00Z")).toEqual([
        past.json.id,
        future.json.id,
      ]);
      expect(
        (await call(ctx.app, "GET", "/api/reminders?until=soon", { token: ctx.owner })).status,
      ).toBe(400);

      // Other people's batches don't fill Ann's list, even when she can read them...
      await makeServerVisible(ctx, "batches", id);
      expect(await due(ctx.ann)).toEqual([]);
      expect((await add({ kind: "custom", dueAt: "2026-01-01T00:00:00Z" }, ctx.ann)).status).toBe(
        403,
      );
      const done = (reminderId: unknown, token = ctx.owner) =>
        call(ctx.app, "POST", `/api/reminders/${reminderId}/done`, { token });
      expect((await done(past.json.id, ctx.ann)).status).toBe(403);
      // ...but batches shared with her do.
      await ctx.sql.query(
        "INSERT INTO shares (resource_type, resource_id, to_user_id, level) VALUES ('batch', $1, $2, 'edit')",
        [id, ctx.annId],
      );
      expect(await due(ctx.ann)).toEqual([past.json.id]);

      const first = await done(past.json.id, ctx.ann);
      expect(first.status).toBe(200);
      expect(first.json.doneAt).toEqual(expect.any(String));
      expect((await done(past.json.id)).json.doneAt).toBe(first.json.doneAt);
      expect(await due(ctx.owner)).toEqual([]);
      expect((await done(crypto.randomUUID())).status).toBe(404);

      const list = await call(ctx.app, "GET", `/api/batches/${id}/reminders`, { token: ctx.owner });
      expect((list.json as unknown as Json[]).map((r) => r.id)).toEqual([
        past.json.id,
        future.json.id,
      ]);
    });
  });

  it("keeps notes on recipes, batches or on their own, with tasting scores", async () => {
    await withBatches(async (ctx) => {
      const recipeId = await recipe(ctx);
      const { id: batchId } = await batch(ctx, recipeId);
      const add = (body: object, token = ctx.owner) =>
        call(ctx.app, "POST", "/api/notes", { token, body });

      const plain = await add({ body: "Order more Cascade" });
      expect(plain.status).toBe(201);
      expect(plain.json).toMatchObject({
        kind: "general",
        recipeId: null,
        batchId: null,
        scores: null,
        visibility: "private",
      });
      const onRecipe = await add({ body: "Try more crystal next time", recipeId });
      const tasting = await add({
        kind: "tasting",
        body: "Bright, citrusy, a touch thin",
        batchId,
        scores: { aroma: 10, flavor: 18 },
      });
      expect(tasting.json.scores).toEqual({
        aroma: 10,
        appearance: null,
        flavor: 18,
        mouthfeel: null,
        overall: null,
        total: 28,
      });
      const untried = await add({ kind: "tasting", body: "Not scored yet", batchId });
      expect(untried.json.scores).toMatchObject({ total: null });

      for (const bad of [
        { body: "x", scores: { aroma: 5 } },
        { kind: "tasting", body: "x", scores: { aroma: 13 } },
        { kind: "tasting", body: "x", scores: { appearance: 2.5 } },
        { body: "x", recipeId, batchId },
        { body: "" },
      ]) {
        expect((await add(bad)).status, JSON.stringify(bad)).toBe(400);
      }
      expect((await add({ body: "x", recipeId: crypto.randomUUID() })).status).toBe(404);
      // Ann can't note a recipe she can't read.
      expect((await add({ body: "x", recipeId }, ctx.ann)).status).toBe(404);

      const ids = async (token: string | undefined, query = "") =>
        ((await call(ctx.app, "GET", `/api/notes${query}`, { token })).json.items as Json[]).map(
          (n) => n.id,
        );
      expect(await ids(ctx.owner, `?recipeId=${recipeId}`)).toEqual([onRecipe.json.id]);
      expect(await ids(ctx.owner, `?batchId=${batchId}`)).toEqual([
        untried.json.id,
        tasting.json.id,
      ]);
      expect(await ids(ctx.owner)).toHaveLength(4);
      expect(await ids(ctx.ann)).toEqual([]);
      expect(await ids(undefined)).toEqual([]);

      const path = `/api/notes/${tasting.json.id}`;
      expect((await call(ctx.app, "GET", path, { token: ctx.ann })).status).toBe(404);
      const patched = await call(ctx.app, "PATCH", path, {
        token: ctx.owner,
        body: { body: "Better after a week", scores: { aroma: null, overall: 8 } },
      });
      expect(patched.json).toMatchObject({
        body: "Better after a week",
        scores: { aroma: null, flavor: 18, overall: 8, total: 26 },
      });
      const generalScores = await call(ctx.app, "PATCH", `/api/notes/${plain.json.id}`, {
        token: ctx.owner,
        body: { scores: { overall: 5 } },
      });
      expect(generalScores.status).toBe(400);
      expect(
        (await call(ctx.app, "PATCH", path, { token: ctx.ann, body: { body: "x" } })).status,
      ).toBe(404);
      await makeServerVisible(ctx, "notes", plain.json.id as string);
      expect(
        (await call(ctx.app, "GET", `/api/notes/${plain.json.id}`, { token: ctx.ann })).status,
      ).toBe(200);
      expect(
        (await call(ctx.app, "DELETE", `/api/notes/${plain.json.id}`, { token: ctx.ann })).status,
      ).toBe(403);

      expect(
        (await call(ctx.app, "DELETE", `/api/notes/${onRecipe.json.id}`, { token: ctx.owner }))
          .status,
      ).toBe(204);
      expect(
        (await call(ctx.app, "GET", `/api/notes/${onRecipe.json.id}`, { token: ctx.owner })).status,
      ).toBe(404);
    });
  });

  it("deletes a batch with everything on it", async () => {
    await withBatches(async (ctx) => {
      const recipeId = await recipe(ctx);
      const { id } = await batch(ctx, recipeId);
      await call(ctx.app, "POST", `/api/batches/${id}/readings`, {
        token: ctx.owner,
        body: { takenAt: "2026-11-20T10:00:00Z", gravitySg: 1.05 },
      });
      const note = await call(ctx.app, "POST", "/api/notes", {
        token: ctx.owner,
        body: { body: "Brew day went fine", batchId: id },
      });

      expect((await call(ctx.app, "DELETE", `/api/batches/${id}`, { token: ctx.ann })).status).toBe(
        404,
      );
      await makeServerVisible(ctx, "batches", id);
      expect((await call(ctx.app, "DELETE", `/api/batches/${id}`, { token: ctx.ann })).status).toBe(
        403,
      );
      expect(
        (await call(ctx.app, "DELETE", `/api/batches/${id}`, { token: ctx.owner })).status,
      ).toBe(204);
      expect((await call(ctx.app, "GET", `/api/batches/${id}`, { token: ctx.owner })).status).toBe(
        404,
      );
      expect(
        (await call(ctx.app, "GET", `/api/notes/${note.json.id}`, { token: ctx.owner })).status,
      ).toBe(404);
      const left = await ctx.sql.query("SELECT count(*)::int AS n FROM readings");
      expect(left.rows[0].n).toBe(0);
      // With its last batch gone, the recipe can be deleted.
      expect(
        (await call(ctx.app, "DELETE", `/api/recipes/${recipeId}`, { token: ctx.owner })).status,
      ).toBe(204);
    });
  });
});
