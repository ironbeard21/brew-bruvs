// SPDX-License-Identifier: AGPL-3.0-or-later
// Account settings, admin user management, password reset links and sign-in rate limits,
// against a real Postgres database (set TEST_DATABASE_URL; skipped otherwise).
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import {
  admin,
  ann,
  call,
  invite,
  setupAdmin,
  TEST_DATABASE_URL,
  type TestApp,
  withApp,
} from "./helpers.ts";

/** Admin plus Ann (invited), both signed in with app tokens. */
async function twoUsers(app: TestApp) {
  const adminToken = await setupAdmin(app);
  const code = await invite(app, adminToken);
  const r = await call(app, "POST", "/api/auth/signup", {
    body: { ...ann, inviteCode: code, client: "app" },
  });
  expect(r.status).toBe(201);
  const annId = (r.json.user as { id: string }).id;
  return { adminToken, annToken: r.json.token as string, annId };
}

const login = (app: TestApp, email: string, password: string, ip = "198.51.100.1") =>
  call(app, "POST", "/api/auth/login", { body: { email, password, client: "app" }, ip });

const resetToken = (url: string) => new URL(url).hash.replace("#token=", "");

describe.skipIf(!TEST_DATABASE_URL)("account API (TEST_DATABASE_URL)", () => {
  describe("settings", () => {
    it("changes display name and units", async () => {
      await withApp({}, async (app) => {
        const { annToken } = await twoUsers(app);
        expect((await call(app, "GET", "/api/me", { token: annToken })).json.units).toBe("us");

        const r = await call(app, "PATCH", "/api/me", {
          token: annToken,
          body: { displayName: " Ann B ", units: "metric" },
        });
        expect(r.status).toBe(200);
        expect(r.json).toMatchObject({ displayName: "Ann B", units: "metric" });
        expect((await call(app, "GET", "/api/me", { token: annToken })).json).toMatchObject({
          displayName: "Ann B",
          units: "metric",
        });
      });
    });

    it("needs a change, valid values and a signed-in user", async () => {
      await withApp({}, async (app) => {
        const { annToken } = await twoUsers(app);
        const empty = await call(app, "PATCH", "/api/me", { token: annToken, body: {} });
        expect(empty.status).toBe(400);
        const bad = await call(app, "PATCH", "/api/me", {
          token: annToken,
          body: { units: "imperial" },
        });
        expect(bad.status).toBe(400);
        const anon = await call(app, "PATCH", "/api/me", { body: { units: "metric" } });
        expect(anon.status).toBe(401);
      });
    });
  });

  describe("change password", () => {
    it("checks the current password, then signs out other sessions", async () => {
      await withApp({}, async (app) => {
        const { annToken } = await twoUsers(app);
        const other = (await login(app, ann.email, ann.password)).json.token as string;

        const wrong = await call(app, "POST", "/api/me/password", {
          token: annToken,
          body: { currentPassword: "nope", newPassword: "new-password" },
        });
        expect(wrong.status).toBe(403);
        expect(wrong.json.error?.code).toBe("wrong_password");

        const ok = await call(app, "POST", "/api/me/password", {
          token: annToken,
          body: { currentPassword: ann.password, newPassword: "new-password" },
        });
        expect(ok.status).toBe(204);
        expect((await call(app, "GET", "/api/me", { token: annToken })).status).toBe(200);
        expect((await call(app, "GET", "/api/me", { token: other })).status).toBe(401);
        expect((await login(app, ann.email, ann.password)).status).toBe(401);
        expect((await login(app, ann.email, "new-password")).status).toBe(200);
      });
    });

    it("refuses personal API tokens, short passwords and SSO-only accounts", async () => {
      await withApp({}, async (app, sql: Client) => {
        const { annToken, annId } = await twoUsers(app);
        const personal = await call(app, "POST", "/api/auth/tokens", {
          token: annToken,
          body: { name: "script", scopes: ["read", "write"] },
        });
        const viaToken = await call(app, "POST", "/api/me/password", {
          token: personal.json.token as string,
          body: { currentPassword: ann.password, newPassword: "new-password" },
        });
        expect(viaToken.status).toBe(403);

        const short = await call(app, "POST", "/api/me/password", {
          token: annToken,
          body: { currentPassword: ann.password, newPassword: "short" },
        });
        expect(short.status).toBe(400);

        await sql.query("UPDATE users SET password_hash = NULL WHERE id = $1", [annId]);
        const sso = await call(app, "POST", "/api/me/password", {
          token: annToken,
          body: { currentPassword: "anything", newPassword: "new-password" },
        });
        expect(sso.status).toBe(409);
        expect(sso.json.error?.code).toBe("no_password");
      });
    });
  });

  describe("admin users", () => {
    it("lists accounts for admins only", async () => {
      await withApp({}, async (app) => {
        const { adminToken, annToken } = await twoUsers(app);
        const list = await call(app, "GET", "/api/admin/users", { token: adminToken });
        expect(list.status).toBe(200);
        expect(list.json).toEqual([
          expect.objectContaining({ email: admin.email, isAdmin: true, disabled: false }),
          expect.objectContaining({ email: ann.email, isAdmin: false, disabled: false }),
        ]);
        expect((await call(app, "GET", "/api/admin/users", { token: annToken })).status).toBe(403);
        expect((await call(app, "GET", "/api/admin/users")).status).toBe(401);
      });
    });

    it("disables an account, cutting off its tokens and sign-in, then re-enables it", async () => {
      await withApp({}, async (app) => {
        const { adminToken, annToken, annId } = await twoUsers(app);
        const off = await call(app, "POST", `/api/admin/users/${annId}/disable`, {
          token: adminToken,
        });
        expect(off.status).toBe(200);
        expect(off.json).toMatchObject({ id: annId, disabled: true });

        expect((await call(app, "GET", "/api/me", { token: annToken })).status).toBe(401);
        const blocked = await login(app, ann.email, ann.password);
        expect(blocked.status).toBe(403);
        expect(blocked.json.error?.code).toBe("account_disabled");
        // A wrong password still looks like any other failed login.
        expect((await login(app, ann.email, "wrong-password")).status).toBe(401);

        const on = await call(app, "POST", `/api/admin/users/${annId}/enable`, {
          token: adminToken,
        });
        expect(on.json).toMatchObject({ id: annId, disabled: false });
        expect((await login(app, ann.email, ann.password)).status).toBe(200);
        // Tokens revoked by disabling stay revoked.
        expect((await call(app, "GET", "/api/me", { token: annToken })).status).toBe(401);
      });
    });

    it("refuses non-admins, the admin's own account, unknown and malformed ids", async () => {
      await withApp({}, async (app) => {
        const { adminToken, annToken, annId } = await twoUsers(app);
        const me = (await call(app, "GET", "/api/me", { token: adminToken })).json.id;
        const path = (id: unknown) => `/api/admin/users/${id}/disable`;
        expect((await call(app, "POST", path(annId), { token: annToken })).status).toBe(403);
        const self = await call(app, "POST", path(me), { token: adminToken });
        expect(self.status).toBe(409);
        expect(self.json.error?.code).toBe("cannot_disable_self");
        const unknown = "01900000-0000-7000-8000-000000000000";
        expect((await call(app, "POST", path(unknown), { token: adminToken })).status).toBe(404);
        expect((await call(app, "POST", path("nope"), { token: adminToken })).status).toBe(400);
      });
    });
  });

  describe("password reset links", () => {
    it("sets a new password once and signs the user out everywhere", async () => {
      await withApp({}, async (app) => {
        const { adminToken, annToken, annId } = await twoUsers(app);
        const link = await call(app, "POST", `/api/admin/users/${annId}/password-reset`, {
          token: adminToken,
        });
        expect(link.status).toBe(201);
        const url = link.json.url as string;
        expect(url).toMatch(/^http:\/\/brew\.test\/reset-password#token=bb_/);
        const token = resetToken(url);

        const r = await call(app, "POST", "/api/auth/password-reset", {
          body: { token, password: "reset-password" },
        });
        expect(r.status).toBe(204);
        expect((await call(app, "GET", "/api/me", { token: annToken })).status).toBe(401);
        expect((await login(app, ann.email, ann.password)).status).toBe(401);
        expect((await login(app, ann.email, "reset-password")).status).toBe(200);

        const again = await call(app, "POST", "/api/auth/password-reset", {
          body: { token, password: "another-password" },
        });
        expect(again.status).toBe(400);
        expect(again.json.error?.code).toBe("invalid_reset");
      });
    });

    it("refuses expired and unknown links, and non-admins creating them", async () => {
      await withApp({}, async (app, sql: Client) => {
        const { adminToken, annToken, annId } = await twoUsers(app);
        expect(
          (await call(app, "POST", `/api/admin/users/${annId}/password-reset`, { token: annToken }))
            .status,
        ).toBe(403);
        const link = await call(app, "POST", `/api/admin/users/${annId}/password-reset`, {
          token: adminToken,
        });
        await sql.query("UPDATE password_resets SET expires_at = now() - interval '1 minute'");
        const expired = await call(app, "POST", "/api/auth/password-reset", {
          body: { token: resetToken(link.json.url as string), password: "reset-password" },
        });
        expect(expired.status).toBe(400);
        const unknown = await call(app, "POST", "/api/auth/password-reset", {
          body: { token: "bb_nope", password: "reset-password" },
        });
        expect(unknown.status).toBe(400);
        const missing = await call(
          app,
          "POST",
          "/api/admin/users/01900000-0000-7000-8000-000000000000/password-reset",
          {
            token: adminToken,
          },
        );
        expect(missing.status).toBe(404);
      });
    });
  });

  describe("rate limits", () => {
    it("locks an account after 10 failed logins, without touching other accounts", async () => {
      await withApp({}, async (app) => {
        await twoUsers(app);
        for (let i = 0; i < 10; i++) {
          // Different addresses: the per-account limit is what's being tested.
          expect((await login(app, ann.email, "wrong-password", `198.51.100.${i}`)).status).toBe(
            401,
          );
        }
        const locked = await login(app, ann.email.toUpperCase(), ann.password, "203.0.113.9");
        expect(locked.status).toBe(429);
        expect(locked.json.error?.code).toBe("rate_limited");
        expect(Number(locked.res.headers.get("retry-after"))).toBeGreaterThan(800);
        expect((await login(app, admin.email, admin.password, "203.0.113.9")).status).toBe(200);
      });
    }, 60_000);

    it("clears an account's failures after a successful login", async () => {
      await withApp({}, async (app) => {
        await twoUsers(app);
        for (let round = 0; round < 2; round++) {
          for (let i = 0; i < 9; i++) await login(app, ann.email, "wrong-password");
          expect((await login(app, ann.email, ann.password)).status).toBe(200);
        }
      });
    }, 60_000);

    it("limits login attempts per address to 30 in 15 minutes", async () => {
      await withApp({}, async (app) => {
        for (let i = 0; i < 30; i++) {
          expect((await login(app, `nobody${i}@brew.test`, "x", "192.0.2.1")).status).toBe(401);
        }
        expect((await login(app, "nobody@brew.test", "x", "192.0.2.1")).status).toBe(429);
        expect((await login(app, "nobody@brew.test", "x", "192.0.2.2")).status).toBe(401);
      });
    }, 60_000); // 31 deliberately slow scrypt checks

    it("limits sign-ups and reset attempts per address to 10 an hour", async () => {
      await withApp({}, async (app) => {
        await setupAdmin(app);
        const signup = (ip: string) =>
          call(app, "POST", "/api/auth/signup", { body: { ...ann, inviteCode: "bad" }, ip });
        for (let i = 0; i < 10; i++) expect((await signup("192.0.2.5")).status).toBe(403);
        expect((await signup("192.0.2.5")).status).toBe(429);
        const reset = await call(app, "POST", "/api/auth/password-reset", {
          body: { token: "bb_nope", password: "reset-password" },
          ip: "192.0.2.5",
        });
        expect(reset.status).toBe(429);
        expect((await signup("192.0.2.6")).status).toBe(403);
      });
    }, 60_000);
  });
});
