// SPDX-License-Identifier: AGPL-3.0-or-later
// Visibility and shares for batches, notes, inventory, equipment and equipment profiles, and the
// brewery activity feed. Postgres tests need TEST_DATABASE_URL.
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import {
  call,
  invite,
  type Json,
  offlineDeps,
  TEST_DATABASE_URL,
  type TestApp,
  twoUsers,
  withApp,
} from "./helpers.ts";

const content = {
  schemaVersion: 1,
  fermentables: [{ name: "Pale malt", kind: "grain", amountKg: 4.5, potentialSg: 1.037 }],
  hops: [],
  yeasts: [{ name: "US-05", attenuationPct: 78 }],
  miscs: [],
  mash: [],
  fermentation: [],
};
const beer = { name: "House Pale", beverage: "beer", batchSizeL: 20, content };
const code = (r: { json: Json }) => r.json.error?.code;

type Ctx = { app: TestApp; sql: Client; me: string; ann: string; zed: string };

async function withPeople(run: (ctx: Ctx) => Promise<void>) {
  await withApp({}, async (app, sql) => {
    const { adminToken, annToken } = await twoUsers(app);
    const zed = await call(app, "POST", "/api/auth/signup", {
      body: {
        email: "zed@brew.test",
        password: "zed-password",
        displayName: "Zed",
        inviteCode: await invite(app, adminToken),
        client: "app",
      },
    });
    await run({ app, sql, me: adminToken, ann: annToken, zed: zed.json.token as string });
  });
}

const created = async (r: Promise<{ status: number; json: Json }>) => {
  const res = await r;
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json.id as string;
};

/** One of each type, owned by the admin, with a GET and (where one exists) an edit to try. */
async function things(ctx: Ctx) {
  const post = (path: string, body: object) => call(ctx.app, "POST", path, { token: ctx.me, body });
  const recipe = await created(post("/api/recipes", beer));
  const me = await call(ctx.app, "GET", "/api/me", { token: ctx.me });
  const equipment = await ctx.sql.query<{ id: string }>(
    "INSERT INTO equipment_items (uri, owner_user_id, name) VALUES ('https://brew.test/equipment/1', $1, 'Kettle') RETURNING id",
    [me.json.id],
  );
  return [
    {
      segment: "batches",
      id: await created(post("/api/batches", { recipeId: recipe })),
      edit: null,
    },
    {
      segment: "notes",
      id: await created(post("/api/notes", { body: "Smells good" })),
      edit: { body: "Smells great" },
    },
    {
      segment: "inventory",
      id: await created(post("/api/inventory", { name: "Oats", quantity: 1, quantityUnit: "kg" })),
      edit: { quantity: 2 },
    },
    {
      segment: "equipment-profiles",
      id: await created(post("/api/equipment-profiles", { name: "Kettle" })),
      edit: { name: "Big kettle" },
    },
    { segment: "equipment", id: equipment.rows[0]?.id as string, edit: null, noGet: true },
  ];
}

describe("sharing without a database", () => {
  it("needs a session to change visibility or see the feed", async () => {
    const app = createApp(offlineDeps());
    const id = "00000000-0000-7000-8000-000000000000";
    expect(
      (await call(app, "PUT", `/api/notes/${id}/visibility`, { body: { visibility: "public" } }))
        .status,
    ).toBe(401);
    expect((await call(app, "GET", `/api/breweries/${id}/activity`)).status).toBe(401);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("sharing and activity on PostgreSQL", () => {
  it("shares each type with read or edit, and only its owner can change that", async () => {
    await withPeople(async (ctx) => {
      for (const t of await things(ctx)) {
        const path = `/api/${t.segment}/${t.id}`;
        const read = (token: string) => call(ctx.app, "GET", path, { token });
        const shares = `${path}/shares`;
        const share = (body: object, token = ctx.me) =>
          call(ctx.app, "POST", shares, { token, body });

        if (!t.noGet) expect((await read(ctx.ann)).status, path).toBe(404);
        expect((await share({ email: "ann@brew.test", level: "read" }, ctx.ann)).status).toBe(404);
        for (const [body, status] of [
          [{ email: "ann@brew.test", breweryId: t.id, level: "read" }, 400],
          [{ email: "nobody@brew.test", level: "read" }, 404],
          [{ email: "admin@brew.test", level: "read" }, 400],
          [{ breweryId: t.id, level: "read" }, 404],
        ] as const) {
          expect((await share(body)).status, `${path} ${JSON.stringify(body)}`).toBe(status);
        }

        const given = await share({ email: "ANN@brew.test", level: "read" });
        expect(given.json).toMatchObject({ user: { displayName: "Ann" }, level: "read" });
        if (!t.noGet) expect((await read(ctx.ann)).status, path).toBe(200);
        // Readers can't reshare or see the share list.
        expect((await share({ email: "zed@brew.test", level: "read" }, ctx.ann)).status).toBe(403);
        expect((await call(ctx.app, "GET", shares, { token: ctx.ann })).status).toBe(403);

        if (t.edit) {
          const edit = () => call(ctx.app, "PATCH", path, { token: ctx.ann, body: t.edit });
          expect((await edit()).status, path).toBe(403);
          const again = await share({ email: "ann@brew.test", level: "edit" });
          expect(again.json.id).toBe(given.json.id);
          expect((await edit()).status, path).toBe(200);
        }
        const list = await call(ctx.app, "GET", shares, { token: ctx.me });
        expect((list.json as unknown as Json[]).length).toBe(1);

        const unshare = (token: string) =>
          call(ctx.app, "DELETE", `${shares}/${given.json.id}`, { token });
        expect((await unshare(ctx.ann)).status).toBe(403);
        expect((await unshare(ctx.me)).status).toBe(204);
        expect((await unshare(ctx.me)).status).toBe(404);
        if (!t.noGet) expect((await read(ctx.ann)).status, path).toBe(404);
      }
    });
  });

  it("sets visibility for each type: server shows it to everyone signed in", async () => {
    await withPeople(async (ctx) => {
      for (const t of await things(ctx)) {
        const path = `/api/${t.segment}/${t.id}`;
        const set = (visibility: string, token = ctx.me) =>
          call(ctx.app, "PUT", `${path}/visibility`, { token, body: { visibility } });
        expect((await set("everyone")).status).toBe(400);
        expect((await set("server", ctx.zed)).status).toBe(404);
        const done = await set("server");
        expect(done.json).toEqual({ id: t.id, visibility: "server" });
        if (!t.noGet) {
          expect((await call(ctx.app, "GET", path, { token: ctx.zed })).status, path).toBe(200);
          expect((await call(ctx.app, "GET", path)).status, path).toBe(404);
        }
        // Readable now, but still not theirs to change.
        expect((await set("public", ctx.zed)).status).toBe(403);
      }
    });
  });

  it("feeds a brewery's batch moves, readings, inventory use and new members to its members", async () => {
    await withPeople(async (ctx) => {
      const brewery = await created(
        call(ctx.app, "POST", "/api/breweries", { token: ctx.me, body: { name: "Hops Co" } }),
      );
      const sent = await call(ctx.app, "POST", `/api/breweries/${brewery}/invites`, {
        token: ctx.me,
        body: { role: "member", email: "ann@brew.test" },
      });
      await call(ctx.app, "POST", "/api/brewery-invites/accept", {
        token: ctx.ann,
        body: { id: sent.json.id },
      });
      const post = (path: string, body: object, token = ctx.me) =>
        call(ctx.app, "POST", path, { token, body });
      await created(
        post("/api/inventory", {
          name: "Pale malt",
          quantity: 5,
          quantityUnit: "kg",
          breweryId: brewery,
        }),
      );
      const recipe = await created(post("/api/recipes", { ...beer, breweryId: brewery }));
      const batch = await created(post("/api/batches", { recipeId: recipe, breweryId: brewery }));
      await post(`/api/batches/${batch}/status`, { status: "brewing" });
      const reading = await created(
        post(
          `/api/batches/${batch}/readings`,
          { takenAt: "2026-11-24T12:00:00Z", gravitySg: 1.05 },
          ctx.ann,
        ),
      );
      await post(`/api/batches/${batch}/status`, { status: "packaged" });
      // A personal batch has no feed.
      const mine = await created(post("/api/recipes", beer));
      const personal = await created(post("/api/batches", { recipeId: mine }));
      await post(`/api/batches/${personal}/status`, { status: "brewing" });

      const feed = await call(ctx.app, "GET", `/api/breweries/${brewery}/activity`, {
        token: ctx.ann,
      });
      expect(feed.status).toBe(200);
      const items = feed.json.items as Json[];
      expect(items.map((e) => [e.verb, e.status, (e.actor as Json).displayName])).toEqual([
        ["inventory_used", null, "Admin"],
        ["batch_moved", "packaged", "Admin"],
        ["reading_logged", null, "Ann"],
        ["batch_started", "brewing", "Admin"],
        ["member_joined", null, "Ann"],
      ]);
      expect(items.every((e) => e.verb === "member_joined" || (e.batch as Json).id === batch)).toBe(
        true,
      );
      expect(items[2]?.object).toEqual({ type: "reading", id: reading });
      expect(items[4]).toMatchObject({ name: "Ann", object: { type: "user" } });

      const page = await call(
        ctx.app,
        "GET",
        `/api/breweries/${brewery}/activity?limit=2&offset=2`,
        {
          token: ctx.me,
        },
      );
      expect([(page.json.items as Json[])[0]?.verb, page.json.nextOffset]).toEqual([
        "reading_logged",
        4,
      ]);
      const outsider = await call(ctx.app, "GET", `/api/breweries/${brewery}/activity`, {
        token: ctx.zed,
      });
      expect([outsider.status, code(outsider)]).toEqual([404, "not_found"]);
    });
  });
  it("leaves no share behind when one is added while the item is being deleted", async () => {
    await withPeople(async (ctx) => {
      const me = await call(ctx.app, "GET", "/api/me", { token: ctx.ann });
      const kinds = [
        [
          "inventory_item",
          "inventory_items",
          "/api/inventory",
          { name: "Oats", quantity: 1, quantityUnit: "kg" },
        ],
        ["equipment_profile", "equipment_profiles", "/api/equipment-profiles", { name: "Kettle" }],
        ["note", "notes", "/api/notes", { body: "Note" }],
      ] as const;
      for (const [kind, table, path, body] of kinds) {
        const id = await created(call(ctx.app, "POST", path, { token: ctx.me, body }));
        // Another transaction holds the row (as sharing does) and adds a share.
        await ctx.sql.query("BEGIN");
        await ctx.sql.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
        await ctx.sql.query(
          "INSERT INTO shares (resource_type, resource_id, to_user_id, level) VALUES ($1, $2, $3, 'read')",
          [kind, id, me.json.id],
        );
        const removing = call(ctx.app, "DELETE", `${path}/${id}`, { token: ctx.me });
        await new Promise((done) => setTimeout(done, 300));
        await ctx.sql.query("COMMIT");
        expect((await removing).status, kind).toBe(204);
        const left = await ctx.sql.query("SELECT 1 FROM shares WHERE resource_id = $1", [id]);
        expect(left.rowCount, kind).toBe(0);
      }
    });
  });
});
