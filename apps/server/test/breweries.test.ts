// SPDX-License-Identifier: AGPL-3.0-or-later
// Breweries API: members and roles, invites, creating and moving things into a brewery, and
// what each role can do to a brewery batch. Postgres tests need TEST_DATABASE_URL.
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import {
  call,
  invite,
  type Json,
  offlineDeps,
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
const code = (r: { json: Json }) => r.json.error?.code;

type Person = { token: string; id: string; email: string };
const ROLES = ["owner", "brewer", "member", "viewer"] as const;

/** The admin owns "Hops Co"; one person per other role joins it, and an outsider doesn't. */
async function withBrewery(
  run: (ctx: {
    app: TestApp;
    brewery: string;
    people: Record<(typeof ROLES)[number] | "outsider", Person>;
  }) => Promise<void>,
) {
  await withApp({}, async (app) => {
    const adminToken = await setupAdmin(app);
    const me = await call(app, "GET", "/api/me", { token: adminToken });
    const people = {
      owner: { token: adminToken, id: me.json.id as string, email: "admin@brew.test" },
    } as Record<(typeof ROLES)[number] | "outsider", Person>;
    for (const name of ["brewer", "member", "viewer", "outsider"] as const) {
      const email = `${name}@brew.test`;
      const r = await call(app, "POST", "/api/auth/signup", {
        body: {
          email,
          password: `${name}-password`,
          displayName: name,
          inviteCode: await invite(app, adminToken),
          client: "app",
        },
      });
      expect(r.status).toBe(201);
      people[name] = {
        token: r.json.token as string,
        id: (r.json.user as Json).id as string,
        email,
      };
    }
    const created = await call(app, "POST", "/api/breweries", {
      token: adminToken,
      body: { name: "Hops Co", description: "A garage", city: "Leeds" },
    });
    expect(created.status).toBe(201);
    const brewery = created.json.id as string;
    for (const role of ["brewer", "member", "viewer"] as const) {
      const sent = await call(app, "POST", `/api/breweries/${brewery}/invites`, {
        token: adminToken,
        body: { role, email: people[role].email },
      });
      expect(sent.status).toBe(201);
      const joined = await call(app, "POST", "/api/brewery-invites/accept", {
        token: people[role].token,
        body: { id: sent.json.id },
      });
      expect(joined.status).toBe(200);
    }
    await run({ app, brewery, people });
  });
}

describe("breweries without a database", () => {
  it("needs a session", async () => {
    const app = createApp(offlineDeps());
    expect((await call(app, "GET", "/api/breweries")).status).toBe(401);
    expect((await call(app, "POST", "/api/breweries", { body: { name: "x" } })).status).toBe(401);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("breweries API on PostgreSQL", () => {
  it("creates, lists, shows, renames and deletes a brewery for its members only", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const list = await call(app, "GET", "/api/breweries", { token: people.member.token });
      expect(list.json.items).toMatchObject([{ id: brewery, name: "Hops Co", role: "member" }]);
      expect(
        (await call(app, "GET", "/api/breweries", { token: people.outsider.token })).json.items,
      ).toEqual([]);

      const shown = await call(app, "GET", `/api/breweries/${brewery}`, {
        token: people.viewer.token,
      });
      expect(shown.status).toBe(200);
      expect(shown.json).toMatchObject({ description: "A garage", city: "Leeds", role: "viewer" });
      expect((shown.json.members as Json[]).map((m) => m.role)).toEqual([...ROLES]);
      expect(
        (await call(app, "GET", `/api/breweries/${brewery}`, { token: people.outsider.token }))
          .status,
      ).toBe(404);

      for (const role of ["brewer", "member", "viewer"] as const) {
        const r = await call(app, "PATCH", `/api/breweries/${brewery}`, {
          token: people[role].token,
          body: { name: "Mine now" },
        });
        expect(r.status, role).toBe(403);
      }
      const bad = await call(app, "PATCH", `/api/breweries/${brewery}`, {
        token: people.owner.token,
        body: {},
      });
      expect(bad.status).toBe(400);
      expect(
        (
          await call(app, "POST", "/api/breweries", {
            token: people.owner.token,
            body: { name: " " },
          })
        ).status,
      ).toBe(400);
      const renamed = await call(app, "PATCH", `/api/breweries/${brewery}`, {
        token: people.owner.token,
        body: { name: "Malt Co", description: null },
      });
      expect(renamed.json).toMatchObject({ name: "Malt Co", description: null });

      // Not while it owns something.
      const recipe = await call(app, "POST", "/api/recipes", {
        token: people.brewer.token,
        body: { ...beer, breweryId: brewery },
      });
      expect(
        (await call(app, "DELETE", `/api/breweries/${brewery}`, { token: people.brewer.token }))
          .status,
      ).toBe(403);
      const busy = await call(app, "DELETE", `/api/breweries/${brewery}`, {
        token: people.owner.token,
      });
      expect([busy.status, code(busy)]).toEqual([409, "brewery_not_empty"]);
      await call(app, "DELETE", `/api/recipes/${recipe.json.id}`, { token: people.owner.token });
      expect(
        (await call(app, "DELETE", `/api/breweries/${brewery}`, { token: people.owner.token }))
          .status,
      ).toBe(204);
      expect(
        (await call(app, "GET", "/api/breweries", { token: people.member.token })).json.items,
      ).toEqual([]);
    });
  });

  it("invites by email or one-time code, each usable once, and only by owners", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const owner = people.owner.token;
      const path = `/api/breweries/${brewery}/invites`;
      for (const role of ["brewer", "member", "viewer"] as const) {
        const r = await call(app, "POST", path, {
          token: people[role].token,
          body: { role: "member" },
        });
        expect(r.status, role).toBe(403);
      }
      const unknown = await call(app, "POST", path, {
        token: owner,
        body: { role: "member", email: "nobody@brew.test" },
      });
      expect([unknown.status, code(unknown)]).toEqual([404, "unknown_user"]);
      const member = await call(app, "POST", path, {
        token: owner,
        body: { role: "brewer", email: people.member.email },
      });
      expect([member.status, code(member)]).toEqual([409, "already_member"]);
      expect((await call(app, "POST", path, { token: owner, body: { role: "boss" } })).status).toBe(
        400,
      );

      // An email invite: the outsider sees it, can decline it, then accepts a new one.
      const first = await call(app, "POST", path, {
        token: owner,
        body: { role: "viewer", email: people.outsider.email.toUpperCase() },
      });
      expect(first.json).toMatchObject({ role: "viewer", to: { displayName: "outsider" } });
      expect(first.json.code).toBeUndefined();
      const mine = await call(app, "GET", "/api/brewery-invites", { token: people.outsider.token });
      expect(mine.json.items).toMatchObject([{ id: first.json.id, brewery: { name: "Hops Co" } }]);
      expect(
        (
          await call(app, "DELETE", `/api/brewery-invites/${first.json.id}`, {
            token: people.member.token,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call(app, "DELETE", `/api/brewery-invites/${first.json.id}`, {
            token: people.outsider.token,
          })
        ).status,
      ).toBe(204);
      const second = await call(app, "POST", path, {
        token: owner,
        body: { role: "member", email: people.outsider.email },
      });
      const stolen = await call(app, "POST", "/api/brewery-invites/accept", {
        token: people.viewer.token,
        body: { id: second.json.id },
      });
      expect([stolen.status, code(stolen)]).toEqual([404, "invalid_invite"]);
      const joined = await call(app, "POST", "/api/brewery-invites/accept", {
        token: people.outsider.token,
        body: { id: second.json.id },
      });
      expect(joined.json).toMatchObject({ id: brewery, role: "member" });

      // A code invite: shown once, works once, and owners can see and revoke pending ones.
      const made = await call(app, "POST", path, { token: owner, body: { role: "brewer" } });
      expect(made.json).toMatchObject({ role: "brewer", to: null });
      const pendingList = await call(app, "GET", path, { token: owner });
      expect(pendingList.json.items).toEqual([expect.objectContaining({ id: made.json.id })]);
      expect((pendingList.json.items as Json[])[0]?.code).toBeUndefined();
      expect((await call(app, "GET", path, { token: people.brewer.token })).status).toBe(403);

      const signup = await call(app, "POST", "/api/auth/signup", {
        body: {
          email: "new@brew.test",
          password: "new-password",
          displayName: "New",
          inviteCode: await invite(app, owner),
          client: "app",
        },
      });
      const newcomer = signup.json.token as string;
      const viaCode = await call(app, "POST", "/api/brewery-invites/accept", {
        token: newcomer,
        body: { code: made.json.code },
      });
      expect(viaCode.json).toMatchObject({ role: "brewer" });
      const reused = await call(app, "POST", "/api/brewery-invites/accept", {
        token: people.outsider.token,
        body: { code: made.json.code },
      });
      expect([reused.status, code(reused)]).toEqual([404, "invalid_invite"]);

      const revoked = await call(app, "POST", path, { token: owner, body: { role: "viewer" } });
      expect(
        (await call(app, "DELETE", `${path}/${revoked.json.id}`, { token: owner })).status,
      ).toBe(204);
      const gone = await call(app, "POST", "/api/brewery-invites/accept", {
        token: people.outsider.token,
        body: { code: revoked.json.code },
      });
      expect(gone.status).toBe(404);
    });
  });

  it("changes roles, removes members, lets members leave, and always keeps an owner", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const owner = people.owner.token;
      const role = (userId: string, r: string, token = owner) =>
        call(app, "PUT", `/api/breweries/${brewery}/members/${userId}/role`, {
          token,
          body: { role: r },
        });
      const remove = (userId: string, token = owner) =>
        call(app, "DELETE", `/api/breweries/${brewery}/members/${userId}`, { token });

      expect((await role(people.member.id, "brewer", people.brewer.token)).status).toBe(403);
      expect((await role(people.member.id, "admin")).status).toBe(400);
      expect((await role(people.outsider.id, "brewer")).status).toBe(404);
      const promoted = await role(people.member.id, "brewer");
      expect(
        (promoted.json.members as Json[]).find((m) => m.userId === people.member.id)?.role,
      ).toBe("brewer");

      const alone = await role(people.owner.id, "brewer");
      expect([alone.status, code(alone)]).toEqual([409, "last_owner"]);
      const leaving = await remove(people.owner.id);
      expect([leaving.status, code(leaving)]).toEqual([409, "last_owner"]);

      expect((await remove(people.viewer.id, people.brewer.token)).status).toBe(403);
      expect((await remove(people.viewer.id, people.viewer.token)).status).toBe(204);
      expect((await remove(people.member.id)).status).toBe(204);
      expect(
        (await call(app, "GET", `/api/breweries/${brewery}`, { token: people.member.token }))
          .status,
      ).toBe(404);

      const transfer = (userId: string, token = owner) =>
        call(app, "POST", `/api/breweries/${brewery}/transfer`, { token, body: { userId } });
      expect((await transfer(people.owner.id, people.brewer.token)).status).toBe(403);
      expect((await transfer(people.owner.id)).status).toBe(400);
      expect((await transfer(people.outsider.id)).status).toBe(404);
      const handed = await transfer(people.brewer.id);
      expect(handed.json.role).toBe("brewer");
      expect(
        Object.fromEntries((handed.json.members as Json[]).map((m) => [m.displayName, m.role])),
      ).toEqual({ Admin: "brewer", brewer: "owner" });
      // Now the old owner can leave.
      expect((await remove(people.owner.id)).status).toBe(204);
    });
  });

  it("creates recipes, batches, notes and profiles as the brewery's for owners and brewers", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const create = (path: string, token: string, body: object) =>
        call(app, "POST", path, { token, body: { ...body, breweryId: brewery } });
      const recipe = await create("/api/recipes", people.brewer.token, beer);
      expect(recipe.json.owner).toEqual({ type: "brewery", id: brewery });
      const batch = await create("/api/batches", people.owner.token, {
        recipeId: recipe.json.id,
      });
      expect(batch.json.owner).toEqual({ type: "brewery", id: brewery });
      const note = await create("/api/notes", people.brewer.token, { body: "Brew day plan" });
      expect(note.json.owner).toEqual({ type: "brewery", id: brewery });
      const profile = await create("/api/equipment-profiles", people.brewer.token, {
        name: "Kettle",
      });
      expect(profile.status).toBe(201);
      expect(profile.json.owner).toEqual({ type: "brewery", id: brewery });

      for (const role of ["member", "viewer"] as const) {
        const r = await create("/api/recipes", people[role].token, beer);
        expect(r.status, role).toBe(403);
      }
      const outsider = await create("/api/recipes", people.outsider.token, beer);
      expect(outsider.status).toBe(404);
    });
  });

  it("moves your own things into a brewery where you can write", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const mine = await call(app, "POST", "/api/recipes", {
        token: people.member.token,
        body: beer,
      });
      const move = (id: string, token: string, type = "recipes") =>
        call(app, "POST", `/api/${type}/${id}/move`, { token, body: { breweryId: brewery } });
      const asMember = await move(mine.json.id as string, people.member.token);
      expect(asMember.status).toBe(403);

      const brewers = await call(app, "POST", "/api/recipes", {
        token: people.brewer.token,
        body: beer,
      });
      const id = brewers.json.id as string;
      expect((await move(id, people.owner.token)).status).toBe(404);
      const moved = await move(id, people.brewer.token);
      expect(moved.json.owner).toEqual({ type: "brewery", id: brewery });
      const shown = await call(app, "GET", `/api/recipes/${id}`, { token: people.viewer.token });
      expect(shown.json.owner).toEqual({ type: "brewery", id: brewery });
      // Already the brewery's: nobody owns it personally any more.
      expect((await move(id, people.brewer.token)).status).toBe(403);

      const batch = await call(app, "POST", "/api/batches", {
        token: people.brewer.token,
        body: { recipeId: id },
      });
      expect((await move(batch.json.id as string, people.brewer.token, "batches")).status).toBe(
        200,
      );
      const profile = await call(app, "POST", "/api/equipment-profiles", {
        token: people.brewer.token,
        body: { name: "Kettle" },
      });
      expect(
        (await move(profile.json.id as string, people.brewer.token, "equipment-profiles")).status,
      ).toBe(200);
      const note = await call(app, "POST", "/api/notes", {
        token: people.brewer.token,
        body: { body: "Hello" },
      });
      expect((await move(note.json.id as string, people.brewer.token, "notes")).status).toBe(200);
    });
  });

  it("gives each role its own rights on a brewery batch", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const recipe = await call(app, "POST", "/api/recipes", {
        token: people.owner.token,
        body: { ...beer, breweryId: brewery },
      });
      const batch = await call(app, "POST", "/api/batches", {
        token: people.owner.token,
        body: { recipeId: recipe.json.id, breweryId: brewery },
      });
      const id = batch.json.id as string;
      const reading = { takenAt: "2026-11-24T12:00:00Z", gravitySg: 1.05 };
      // Each allowed move goes one step further, so none is a repeat.
      const NEXT = {
        owner: "brewing",
        brewer: "fermenting",
        member: "conditioning",
        viewer: "conditioning",
        outsider: "conditioning",
      };
      const expected = {
        owner: { read: 200, reading: 201, note: 201, recipe: 201, status: 200 },
        brewer: { read: 200, reading: 201, note: 201, recipe: 201, status: 200 },
        member: { read: 200, reading: 201, note: 201, recipe: 403, status: 403 },
        viewer: { read: 200, reading: 403, note: 201, recipe: 403, status: 403 },
        outsider: { read: 404, reading: 404, note: 404, recipe: 404, status: 404 },
      };
      for (const [who, want] of Object.entries(expected)) {
        const token = people[who as keyof typeof people].token;
        const got = {
          read: (await call(app, "GET", `/api/batches/${id}`, { token })).status,
          reading: (
            await call(app, "POST", `/api/batches/${id}/readings`, { token, body: reading })
          ).status,
          note: (
            await call(app, "POST", "/api/notes", {
              token,
              body: { body: "Smells good", batchId: id },
            })
          ).status,
          recipe: (
            await call(app, "POST", `/api/recipes/${recipe.json.id}/versions`, {
              token,
              body: { name: beer.name, batchSizeL: 21, content },
            })
          ).status,
          status: (
            await call(app, "POST", `/api/batches/${id}/status`, {
              token,
              body: { status: NEXT[who as keyof typeof NEXT] },
            })
          ).status,
        };
        expect(got, who).toEqual(want);
      }
    });
  });

  it("lets members change their own readings but not anyone else's", async () => {
    await withBrewery(async ({ app, brewery, people }) => {
      const recipe = await call(app, "POST", "/api/recipes", {
        token: people.owner.token,
        body: { ...beer, breweryId: brewery },
      });
      const batch = await call(app, "POST", "/api/batches", {
        token: people.owner.token,
        body: { recipeId: recipe.json.id, breweryId: brewery },
      });
      const path = `/api/batches/${batch.json.id}/readings`;
      const log = (token: string) =>
        call(app, "POST", path, {
          token,
          body: { takenAt: "2026-11-24T12:00:00Z", gravitySg: 1.05 },
        });
      const own = await log(people.member.token);
      const brewers = await log(people.brewer.token);
      const patch = (readingId: unknown, token: string) =>
        call(app, "PATCH", `${path}/${readingId}`, { token, body: { gravitySg: 1.04 } });
      expect((await patch(own.json.id, people.member.token)).status).toBe(200);
      expect((await patch(brewers.json.id, people.member.token)).status).toBe(403);
      expect((await patch(own.json.id, people.brewer.token)).status).toBe(200);
      expect(
        (await call(app, "DELETE", `${path}/${brewers.json.id}`, { token: people.member.token }))
          .status,
      ).toBe(403);
      expect(
        (await call(app, "DELETE", `${path}/${own.json.id}`, { token: people.member.token }))
          .status,
      ).toBe(204);
    });
  });
});
