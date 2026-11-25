// SPDX-License-Identifier: AGPL-3.0-or-later
// Row-level security parity (ADR-0011): the same permission cases through can() (what the API
// checks), the database policies (as brew_app, straight against Postgres), and the API itself.
// Postgres tests need TEST_DATABASE_URL.
import { APP_ROLE, checkRowSecurity, createDb } from "@brew-bruvs/db";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  type Action,
  type BreweryRole,
  can,
  type Resource,
  type User,
} from "../src/permissions.ts";
import {
  call,
  invite,
  type Json,
  setupAdmin,
  TEST_DATABASE_URL,
  type TestApp,
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
const ACTIONS: Action[] = ["read", "contribute", "edit", "delete", "share"];
const PEOPLE = ["owner", "brewer", "member", "viewer", "reader", "editor", "outsider"] as const;
type Person = (typeof PEOPLE)[number];

const TYPES = {
  recipe: { table: "recipes", path: "recipes" },
  batch: { table: "batches", path: "batches" },
  note: { table: "notes", path: "notes" },
  inventory_item: { table: "inventory_items", path: "inventory" },
  equipment_item: { table: "equipment_items", path: "equipment" },
  equipment_profile: { table: "equipment_profiles", path: "equipment-profiles" },
} as const;
type Kind = keyof typeof TYPES;

/**
 * The admin owns everything and the brewery "Hops Co"; brewer, member and viewer belong to it.
 * Each type comes as: the brewery's; private with a read share to `reader` and an edit share to
 * `editor`; private and shared with the brewery to edit; server; unlisted; public.
 */
async function fixture(app: TestApp) {
  const owner = await setupAdmin(app);
  const tokens = { owner } as Record<Person, string>;
  const emails = {} as Record<Person, string>;
  for (const p of PEOPLE.slice(1)) {
    emails[p] = `${p}@brew.test`;
    const r = await call(app, "POST", "/api/auth/signup", {
      body: {
        email: emails[p],
        password: `${p}-password`,
        displayName: p,
        inviteCode: await invite(app, owner),
        client: "app",
      },
    });
    tokens[p] = r.json.token as string;
  }
  const post = async (path: string, body: object) => {
    const r = await call(app, "POST", path, { token: owner, body });
    expect(r.status, `${path} ${JSON.stringify(r.json)}`).toBeLessThan(300);
    return r.json as Json & { id: string };
  };
  const brewery = (await post("/api/breweries", { name: "Hops Co" })).id;
  for (const role of ["brewer", "member", "viewer"] as const) {
    const sent = await post(`/api/breweries/${brewery}/invites`, { role, email: emails[role] });
    await call(app, "POST", "/api/brewery-invites/accept", {
      token: tokens[role],
      body: { id: sent.id },
    });
  }

  const recipeId = (await post("/api/recipes", beer)).id;
  const make = async (kind: Kind, breweryId?: string) => {
    const b = breweryId ? { breweryId } : {};
    switch (kind) {
      case "recipe":
        return (await post("/api/recipes", { ...beer, ...b })).id;
      case "batch":
        return (await post("/api/batches", { recipeId, ...b })).id;
      case "note":
        return (await post("/api/notes", { body: "Note", ...b })).id;
      case "inventory_item":
        return (
          await post("/api/inventory", { name: "Oats", quantity: 1, quantityUnit: "kg", ...b })
        ).id;
      case "equipment_item":
        return (await post("/api/equipment", { name: "Kettle", ...b })).id;
      case "equipment_profile":
        return (await post("/api/equipment-profiles", { name: "Kettle", ...b })).id;
    }
  };
  const setVisibility = (kind: Kind, id: string, visibility: string) =>
    kind === "recipe"
      ? call(app, "PATCH", `/api/recipes/${id}`, { token: owner, body: { visibility } })
      : call(app, "PUT", `/api/${TYPES[kind].path}/${id}/visibility`, {
          token: owner,
          body: { visibility },
        });
  const share = (kind: Kind, id: string, body: object) =>
    post(`/api/${TYPES[kind].path}/${id}/shares`, body);

  const objects: { kind: Kind; id: string; label: string }[] = [];
  for (const kind of Object.keys(TYPES) as Kind[]) {
    objects.push({ kind, id: await make(kind, brewery), label: "brewery's" });
    const shared = await make(kind);
    await share(kind, shared, { email: emails.reader, level: "read" });
    await share(kind, shared, { email: emails.editor, level: "edit" });
    objects.push({ kind, id: shared, label: "shared with people" });
    const toBrewery = await make(kind);
    await share(kind, toBrewery, { breweryId: brewery, level: "edit" });
    objects.push({ kind, id: toBrewery, label: "shared with the brewery" });
    for (const visibility of ["server", "unlisted", "public"]) {
      const id = await make(kind);
      expect((await setVisibility(kind, id, visibility)).status).toBe(200);
      objects.push({ kind, id, label: visibility });
    }
  }
  return { tokens, objects };
}

/** What can() decides, from the rows as they are (read as the owning role). */
async function expected(sql: Client, kind: Kind, id: string, userId: string | null) {
  const { rows } = await sql.query(
    `SELECT owner_user_id, owner_brewery_id, visibility FROM ${TYPES[kind].table} WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  const grants = await sql.query(
    "SELECT to_user_id, to_brewery_id, level FROM shares WHERE resource_type = $1 AND resource_id = $2",
    [kind, id],
  );
  const resource: Resource = {
    owner: row.owner_user_id
      ? { type: "user", id: row.owner_user_id }
      : { type: "brewery", id: row.owner_brewery_id },
    visibility: row.visibility,
    shares: grants.rows.map((s) => ({
      to: s.to_user_id
        ? { type: "user", id: s.to_user_id }
        : { type: "brewery", id: s.to_brewery_id },
      level: s.level,
    })),
  };
  let user: User | null = null;
  if (userId) {
    const m = await sql.query<{ brewery_id: string; role: BreweryRole }>(
      "SELECT brewery_id, role FROM memberships WHERE user_id = $1",
      [userId],
    );
    user = {
      id: userId,
      memberships: m.rows.map((r) => ({ breweryId: r.brewery_id, role: r.role })),
    };
  }
  return Object.fromEntries(ACTIONS.map((a) => [a, can(user, a, resource)])) as Record<
    Action,
    boolean
  >;
}

/** Runs `work` as brew_app acting for `userId`, inside a transaction that is rolled back. */
async function asApp<T>(sql: Client, userId: string | null, work: () => Promise<T>) {
  await sql.query("BEGIN");
  try {
    await sql.query(`SET LOCAL ROLE ${APP_ROLE}`);
    await sql.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
    return await work();
  } finally {
    await sql.query("ROLLBACK");
  }
}

/** What the policies let brew_app do to the row: read it, change it, delete it. */
async function enforced(sql: Client, kind: Kind, id: string, userId: string | null) {
  const table = TYPES[kind].table;
  const count = async (query: string) => {
    await sql.query("SAVEPOINT attempt");
    try {
      return (await sql.query(query, [id])).rowCount ?? 0;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Restricted by a foreign key (recipe with batches): the policy allowed the delete.
      if (code === "23001") return 1;
      // Refused by the guard trigger (owner or visibility change).
      if (code === "42501") return 0;
      throw err;
    } finally {
      await sql.query("ROLLBACK TO SAVEPOINT attempt");
    }
  };
  return asApp(sql, userId, async () => ({
    policy: Object.fromEntries(
      await Promise.all(
        ACTIONS.map(async (a) => {
          const r = await sql.query<{ ok: boolean }>("SELECT app.can_on($1, $2, $3) AS ok", [
            a,
            kind,
            id,
          ]);
          return [a, r.rows[0]?.ok];
        }),
      ),
    ) as Record<Action, boolean>,
    read: (await count(`SELECT 1 FROM ${table} WHERE id = $1`)) === 1,
    change: (await count(`UPDATE ${table} SET updated_at = updated_at WHERE id = $1`)) === 1,
    reveal:
      (await count(
        `UPDATE ${table} SET visibility = CASE WHEN visibility = 'public' THEN 'private'::visibility ELSE 'public'::visibility END WHERE id = $1`,
      )) === 1,
    remove: (await count(`DELETE FROM ${table} WHERE id = $1`)) === 1,
  }));
}

describe.skipIf(!TEST_DATABASE_URL)("row-level security on PostgreSQL", () => {
  it("runs the server as brew_app, which can't bypass row-level security", async () => {
    await withApp({}, async (_app, sql) => {
      const url = new URL(TEST_DATABASE_URL as string);
      url.pathname = `/${sql.database}`;
      const { db, close } = createDb(url.href, { role: APP_ROLE });
      try {
        const { rows } = await db.$client.query(
          "SELECT current_user AS name, rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user",
        );
        expect(rows).toEqual([{ name: APP_ROLE, bypass: false }]);
      } finally {
        await close();
      }
    });
  });

  it("agrees with can() and the API for every person, type, visibility and share", async () => {
    await withApp({}, async (app, sql) => {
      const { tokens, objects } = await fixture(app);
      const ids = Object.fromEntries(
        await Promise.all(
          PEOPLE.map(async (p) => {
            const me = await call(app, "GET", "/api/me", { token: tokens[p] });
            return [p, me.json.id as string];
          }),
        ),
      ) as Record<Person, string>;
      const who: [string, string | null, string | undefined][] = [
        ...PEOPLE.map((p) => [p, ids[p], tokens[p]] as [string, string, string]),
        ["anonymous", null, undefined],
      ];

      const mismatches: string[] = [];
      for (const { kind, id, label } of objects) {
        for (const [name, userId, token] of who) {
          const want = await expected(sql, kind, id, userId);
          const got = await enforced(sql, kind, id, userId);
          const where = `${name} on ${kind} (${label})`;
          for (const a of ACTIONS) {
            if (got.policy[a] !== want[a])
              mismatches.push(`${where}: policy ${a} ${got.policy[a]}`);
          }
          if (got.read !== want.read) mismatches.push(`${where}: row read ${got.read}`);
          if (got.reveal !== want.share)
            mismatches.push(`${where}: visibility change ${got.reveal}`);
          if (got.change !== (want.edit || want.share)) {
            mismatches.push(`${where}: row change ${got.change}`);
          }
          if (got.remove !== want.delete) mismatches.push(`${where}: row delete ${got.remove}`);
          if (token) {
            const api = await call(app, "GET", `/api/${TYPES[kind].path}/${id}`, { token });
            if ((api.status === 200) !== want.read) mismatches.push(`${where}: API ${api.status}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
      // Every case ran: 36 objects × 8 people.
      expect(objects.length * who.length).toBe(288);
    });
  }, 120_000);

  it("keeps a reader from moving something into their own hands", async () => {
    await withApp({}, async (app, sql) => {
      const { tokens, objects } = await fixture(app);
      const me = await call(app, "GET", "/api/me", { token: tokens.editor });
      const shared = objects.find((o) => o.kind === "recipe" && o.label === "shared with people");
      const moved = await asApp(sql, me.json.id as string, async () => {
        await sql.query("SAVEPOINT attempt");
        try {
          await sql.query("UPDATE recipes SET owner_user_id = $2 WHERE id = $1", [
            shared?.id,
            me.json.id,
          ]);
          return "moved";
        } catch (err) {
          return (err as { code?: string }).code;
        }
      });
      // The editor may edit it, but only its owner may hand it to someone else.
      expect(moved).toBe("42501");
    });
  });
  it("lets a batch editor use the owner's stock without double-booking hidden holds", async () => {
    await withApp({}, async (app) => {
      const owner = await setupAdmin(app);
      const signup = await call(app, "POST", "/api/auth/signup", {
        body: {
          email: "editor@brew.test",
          password: "editor-password",
          displayName: "Editor",
          inviteCode: await invite(app, owner),
          client: "app",
        },
      });
      const editor = signup.json.token as string;
      const post = (path: string, body: object, token = owner) =>
        call(app, "POST", path, { token, body });
      const lot = await post("/api/inventory", {
        name: "Pale malt",
        quantity: 5,
        quantityUnit: "kg",
        alphaAcidPct: null,
      });
      const recipe = await post("/api/recipes", beer);
      // The owner's own private batch already holds 4.5 kg of the 5.
      const held = await post("/api/batches", { recipeId: recipe.json.id });
      await post(`/api/batches/${held.json.id}/status`, { status: "brewing" });
      const shared = await post("/api/batches", { recipeId: recipe.json.id });
      await post(`/api/batches/${shared.json.id}/shares`, {
        email: "editor@brew.test",
        level: "edit",
      });
      await post(`/api/recipes/${recipe.json.id}/shares`, {
        email: "editor@brew.test",
        level: "read",
      });

      const started = await post(
        `/api/batches/${shared.json.id}/status`,
        { status: "brewing" },
        editor,
      );
      expect(started.status).toBe(200);
      const change = started.json.inventory as Json;
      expect((change.reserved as Json[]).map((r) => r.quantity)).toEqual([0.5]);
      expect((change.short as Json[]).map((s) => s.short)).toEqual([4]);
      // The editor can't read the lot itself, but sees what the batch holds.
      expect(
        (await call(app, "GET", `/api/inventory/${lot.json.id}`, { token: editor })).status,
      ).toBe(404);
      const holds = await call(app, "GET", `/api/batches/${shared.json.id}/reservations`, {
        token: editor,
      });
      expect(holds.json.items).toEqual([
        { itemId: lot.json.id, name: "Pale malt", quantity: 0.5, unit: "kg", state: "reserved" },
      ]);
      expect(
        (await call(app, "GET", `/api/batches/${shared.json.id}/stats`, { token: editor })).status,
      ).toBe(200);
    });
  });

  it("lets a collaborator outside the brewery log and move a brewery batch shared with them", async () => {
    await withApp({}, async (app) => {
      const owner = await setupAdmin(app);
      const signup = await call(app, "POST", "/api/auth/signup", {
        body: {
          email: "friend@brew.test",
          password: "friend-password",
          displayName: "Friend",
          inviteCode: await invite(app, owner),
          client: "app",
        },
      });
      const friend = signup.json.token as string;
      const post = (path: string, body: object, token = owner) =>
        call(app, "POST", path, { token, body });
      const brewery = await post("/api/breweries", { name: "Hops Co" });
      const recipe = await post("/api/recipes", { ...beer, breweryId: brewery.json.id });
      const batch = await post("/api/batches", {
        recipeId: recipe.json.id,
        breweryId: brewery.json.id,
      });
      await post(`/api/batches/${batch.json.id}/shares`, {
        email: "friend@brew.test",
        level: "edit",
      });

      const reading = await post(
        `/api/batches/${batch.json.id}/readings`,
        { takenAt: "2026-11-25T12:00:00Z", gravitySg: 1.05 },
        friend,
      );
      expect(reading.status).toBe(201);
      const moved = await post(
        `/api/batches/${batch.json.id}/status`,
        { status: "brewing" },
        friend,
      );
      expect(moved.status).toBe(200);
      const feed = await call(app, "GET", `/api/breweries/${brewery.json.id}/activity`, {
        token: owner,
      });
      expect(
        (feed.json.items as Json[]).map((e) => [e.verb, (e.actor as Json).displayName]),
      ).toEqual([
        ["batch_started", "Friend"],
        ["reading_logged", "Friend"],
      ]);
    });
  });

  it("refuses to run the server unless row-level security really applies", async () => {
    await withApp({}, async (_app, sql) => {
      const url = new URL(TEST_DATABASE_URL as string);
      url.pathname = `/${sql.database}`;
      const owner = createDb(url.href);
      const app = createDb(url.href, { role: APP_ROLE });
      try {
        await expect(checkRowSecurity(owner.db)).rejects.toThrow(/not brew_app/);
        await checkRowSecurity(app.db);
        await sql.query("ALTER TABLE notes DISABLE ROW LEVEL SECURITY");
        await expect(checkRowSecurity(app.db)).rejects.toThrow(/on notes/);
      } finally {
        await owner.close();
        await app.close();
      }
    });
  });
});
