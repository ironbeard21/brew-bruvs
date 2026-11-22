// SPDX-License-Identifier: AGPL-3.0-or-later
// Auth API tests against a real Postgres database (set TEST_DATABASE_URL; skipped otherwise).
import { describe, expect, it } from "vitest";
import type { Oidc, OidcClaims } from "../src/auth/oidc.ts";
import {
  admin,
  ann,
  BASE_URL,
  call,
  invite,
  setupAdmin,
  TEST_DATABASE_URL,
  type TestApp,
  withApp,
} from "./helpers.ts";

const sessionCookie = (res: Response) =>
  res.headers.get("set-cookie")?.match(/bb_session=[^;]+/)?.[0];

describe.skipIf(!TEST_DATABASE_URL)("auth API (TEST_DATABASE_URL)", () => {
  describe("first-run setup", () => {
    it("creates the admin, signs them in, then closes", async () => {
      await withApp({}, async (app) => {
        expect((await call(app, "GET", "/api/auth/status")).json).toEqual({
          setupNeeded: true,
          signupMode: "invite",
          oidcEnabled: false,
        });

        const r = await call(app, "POST", "/api/setup", { body: admin });
        expect(r.status).toBe(201);
        expect(r.json.user).toMatchObject({
          email: admin.email,
          displayName: "Admin",
          isAdmin: true,
        });
        expect((r.json.user as { uri: string }).uri).toMatch(new RegExp(`^${BASE_URL}/users/`));
        expect(r.json.token).toBeUndefined();
        const cookie = sessionCookie(r.res);
        expect(r.res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
        expect((await call(app, "GET", "/api/me", { cookie })).json.email).toBe(admin.email);

        expect((await call(app, "GET", "/api/auth/status")).json.setupNeeded).toBe(false);
        const again = await call(app, "POST", "/api/setup", { body: { ...ann } });
        expect(again.status).toBe(409);
        expect(again.json.error?.code).toBe("setup_closed");
      });
    });

    it("rejects invalid input", async () => {
      await withApp({}, async (app) => {
        const r = await call(app, "POST", "/api/setup", { body: { ...admin, password: "short" } });
        expect(r.status).toBe(400);
        expect(r.json.error?.code).toBe("validation_error");
        expect(r.json.error?.message).toContain("password");
      });
    });
  });

  describe("sign-up", () => {
    it("is blocked until setup is done", async () => {
      await withApp({ signupMode: "open" }, async (app) => {
        const r = await call(app, "POST", "/api/auth/signup", { body: ann });
        expect(r.status).toBe(409);
        expect(r.json.error?.code).toBe("setup_required");
      });
    });

    it("open mode: anyone can sign up; emails are unique ignoring case", async () => {
      await withApp({ signupMode: "open" }, async (app) => {
        await setupAdmin(app);
        const r = await call(app, "POST", "/api/auth/signup", { body: ann });
        expect(r.status).toBe(201);
        expect(r.json.user).toMatchObject({ email: ann.email, isAdmin: false });

        const dup = await call(app, "POST", "/api/auth/signup", {
          body: { ...ann, email: "ANN@brew.test" },
        });
        expect(dup.status).toBe(409);
        expect(dup.json.error?.code).toBe("email_taken");
      });
    });

    it("invite-only mode blocks sign-up without a valid invite", async () => {
      await withApp({ signupMode: "invite" }, async (app) => {
        await setupAdmin(app);
        for (const inviteCode of [undefined, "bb_not-a-real-invite"]) {
          const r = await call(app, "POST", "/api/auth/signup", { body: { ...ann, inviteCode } });
          expect(r.status).toBe(403);
          expect(r.json.error?.code).toBe("invite_required");
        }
      });
    });

    it("invite-only mode: an invite works exactly once", async () => {
      await withApp({ signupMode: "invite" }, async (app) => {
        const code = await invite(app, await setupAdmin(app));
        expect(
          (await call(app, "POST", "/api/auth/signup", { body: { ...ann, inviteCode: code } }))
            .status,
        ).toBe(201);
        const reuse = await call(app, "POST", "/api/auth/signup", {
          body: { ...ann, email: "bob@brew.test", inviteCode: code },
        });
        expect(reuse.status).toBe(403);
      });
    });
  });

  describe("login and logout", () => {
    it("web login sets a session cookie; logout ends it", async () => {
      await withApp({}, async (app) => {
        await setupAdmin(app);
        const r = await call(app, "POST", "/api/auth/login", {
          body: { email: "ADMIN@brew.test", password: admin.password },
        });
        expect(r.status).toBe(200);
        const cookie = sessionCookie(r.res);
        expect(cookie).toBeDefined();
        expect((await call(app, "GET", "/api/me", { cookie })).status).toBe(200);

        expect((await call(app, "POST", "/api/auth/logout", { cookie })).status).toBe(204);
        expect((await call(app, "GET", "/api/me", { cookie })).status).toBe(401);
      });
    });

    it("app login returns a token for phones", async () => {
      await withApp({}, async (app) => {
        await setupAdmin(app);
        const r = await call(app, "POST", "/api/auth/login", {
          body: {
            email: admin.email,
            password: admin.password,
            client: "app",
            deviceName: "Pixel",
          },
        });
        expect(r.status).toBe(200);
        expect(sessionCookie(r.res)).toBeUndefined();
        const me = await call(app, "GET", "/api/me", { token: r.json.token as string });
        expect(me.json).toMatchObject({ email: admin.email, isAdmin: true });
      });
    });

    it("wrong password and unknown email both get the same 401", async () => {
      await withApp({}, async (app) => {
        await setupAdmin(app);
        const wrong = await call(app, "POST", "/api/auth/login", {
          body: { email: admin.email, password: "nope-nope" },
        });
        const unknown = await call(app, "POST", "/api/auth/login", {
          body: { email: "who@brew.test", password: "nope-nope" },
        });
        for (const r of [wrong, unknown]) {
          expect(r.status).toBe(401);
          expect(r.json.error).toEqual({
            code: "invalid_credentials",
            message: "Wrong email or password",
          });
        }
      });
    });

    it("rejects a login without a password", async () => {
      await withApp({}, async (app) => {
        const r = await call(app, "POST", "/api/auth/login", { body: { email: admin.email } });
        expect(r.status).toBe(400);
        expect(r.json.error?.code).toBe("validation_error");
      });
    });

    it("an expired session is refused", async () => {
      await withApp({}, async (app, sql) => {
        await setupAdmin(app);
        const r = await call(app, "POST", "/api/auth/login", {
          body: { email: admin.email, password: admin.password },
        });
        await sql.query(
          "UPDATE auth_tokens SET expires_at = now() - interval '1 second' WHERE kind = 'session'",
        );
        expect((await call(app, "GET", "/api/me", { cookie: sessionCookie(r.res) })).status).toBe(
          401,
        );
      });
    });
  });

  describe("tokens", () => {
    it("a revoked app token stops working", async () => {
      await withApp({}, async (app) => {
        const token = await setupAdmin(app);
        const list = await call(app, "GET", "/api/auth/tokens", { token });
        expect(list.status).toBe(200);
        const [appToken] = list.json as unknown as { id: string; kind: string }[];
        expect(appToken?.kind).toBe("app");
        expect(JSON.stringify(list.json)).not.toContain(token);

        expect(
          (await call(app, "DELETE", `/api/auth/tokens/${appToken?.id}`, { token })).status,
        ).toBe(204);
        const after = await call(app, "GET", "/api/me", { token });
        expect(after.status).toBe(401);
        expect(after.json.error?.code).toBe("unauthorized");
      });
    });

    it("personal tokens: shown once; read scope can't write", async () => {
      await withApp({}, async (app) => {
        const adminToken = await setupAdmin(app);
        const created = await call(app, "POST", "/api/auth/tokens", {
          token: adminToken,
          body: { name: "Home Assistant", scopes: ["read"] },
        });
        expect(created.status).toBe(201);
        const readToken = created.json.token as string;
        expect(created.json).toMatchObject({
          kind: "personal",
          name: "Home Assistant",
          scopes: ["read"],
        });

        expect((await call(app, "GET", "/api/me", { token: readToken })).status).toBe(200);
        const write = await call(app, "POST", "/api/invites", { token: readToken });
        expect(write.status).toBe(403);
        expect(write.json.error?.code).toBe("insufficient_scope");

        const rw = await call(app, "POST", "/api/auth/tokens", {
          token: adminToken,
          body: { name: "Script", scopes: ["read", "write"] },
        });
        expect(
          (await call(app, "POST", "/api/invites", { token: rw.json.token as string })).status,
        ).toBe(201);
      });
    });

    it("token routes need sign-in and valid input", async () => {
      await withApp({}, async (app) => {
        const token = await setupAdmin(app);
        expect((await call(app, "GET", "/api/auth/tokens")).status).toBe(401);
        expect(
          (await call(app, "POST", "/api/auth/tokens", { body: { name: "x", scopes: ["read"] } }))
            .status,
        ).toBe(401);
        const bad = await call(app, "POST", "/api/auth/tokens", {
          token,
          body: { name: "x", scopes: ["admin"] },
        });
        expect(bad.status).toBe(400);
        expect((await call(app, "DELETE", "/api/auth/tokens/not-a-uuid", { token })).status).toBe(
          400,
        );
      });
    });

    it("you can't revoke someone else's token", async () => {
      await withApp({ signupMode: "open" }, async (app) => {
        const adminToken = await setupAdmin(app);
        const [adminTokenRow] = (await call(app, "GET", "/api/auth/tokens", { token: adminToken }))
          .json as unknown as {
          id: string;
        }[];
        const annSignup = await call(app, "POST", "/api/auth/signup", {
          body: { ...ann, client: "app" },
        });
        const annToken = annSignup.json.token as string;

        const r = await call(app, "DELETE", `/api/auth/tokens/${adminTokenRow?.id}`, {
          token: annToken,
        });
        expect(r.status).toBe(404);
        expect((await call(app, "GET", "/api/me", { token: adminToken })).status).toBe(200);
      });
    });
  });

  describe("invites", () => {
    it("only admins can create them", async () => {
      await withApp({}, async (app) => {
        const code = await invite(app, await setupAdmin(app));
        const annSignup = await call(app, "POST", "/api/auth/signup", {
          body: { ...ann, inviteCode: code, client: "app" },
        });
        const r = await call(app, "POST", "/api/invites", {
          token: annSignup.json.token as string,
        });
        expect(r.status).toBe(403);
        expect(r.json.error?.code).toBe("forbidden");
        expect((await call(app, "POST", "/api/invites")).status).toBe(401);
      });
    });
  });

  describe("OIDC", () => {
    const fakeOidc = (claims: OidcClaims): Oidc => ({
      start: async () => ({
        url: new URL("https://id.test/authorize?x=1"),
        cookie: "state.verifier",
      }),
      finish: async (url, cookie) => {
        expect(url.href).toBe(`${BASE_URL}/api/auth/oidc/callback?code=abc&state=state`);
        expect(cookie).toBe("state.verifier");
        return claims;
      },
    });
    const claims = {
      issuer: "https://id.test",
      subject: "sub-1",
      email: "ann@brew.test",
      emailVerified: true,
      name: "Ann",
    };

    async function ssoLogin(app: TestApp) {
      const start = await call(app, "GET", "/api/auth/oidc/login");
      expect(start.status).toBe(302);
      expect(start.res.headers.get("location")).toBe("https://id.test/authorize?x=1");
      const oidcCookie = start.res.headers.get("set-cookie")?.match(/bb_oidc=[^;]+/)?.[0];
      return call(app, "GET", "/api/auth/oidc/callback?code=abc&state=state", {
        cookie: oidcCookie,
      });
    }

    it("is off unless configured", async () => {
      await withApp({}, async (app) => {
        expect((await call(app, "GET", "/api/auth/oidc/login")).status).toBe(404);
      });
    });

    it("creates an account on first sign-in, then reuses it", async () => {
      await withApp({ oidc: fakeOidc(claims) }, async (app) => {
        await setupAdmin(app);
        expect((await call(app, "GET", "/api/auth/status")).json.oidcEnabled).toBe(true);

        const first = await ssoLogin(app);
        expect(first.status).toBe(302);
        expect(first.res.headers.get("location")).toBe(`${BASE_URL}/`);
        const me = await call(app, "GET", "/api/me", { cookie: sessionCookie(first.res) });
        expect(me.json).toMatchObject({
          email: "ann@brew.test",
          displayName: "Ann",
          isAdmin: false,
        });

        const second = await ssoLogin(app);
        const me2 = await call(app, "GET", "/api/me", { cookie: sessionCookie(second.res) });
        expect(me2.json.id).toBe(me.json.id);
      });
    });

    it("refuses a disabled account", async () => {
      await withApp({ oidc: fakeOidc(claims) }, async (app) => {
        const adminToken = await setupAdmin(app);
        const first = await ssoLogin(app);
        const me = await call(app, "GET", "/api/me", { cookie: sessionCookie(first.res) });
        const off = await call(app, "POST", `/api/admin/users/${me.json.id}/disable`, {
          token: adminToken,
        });
        expect(off.status).toBe(200);
        const again = await ssoLogin(app);
        expect(again.status).toBe(403);
        expect(again.json.error?.code).toBe("account_disabled");
      });
    });

    it("links to an existing account only when the provider verified the email", async () => {
      await withApp({ oidc: fakeOidc({ ...claims, email: admin.email }) }, async (app) => {
        await setupAdmin(app);
        const r = await ssoLogin(app);
        expect(
          (await call(app, "GET", "/api/me", { cookie: sessionCookie(r.res) })).json.isAdmin,
        ).toBe(true);
      });
      await withApp(
        { oidc: fakeOidc({ ...claims, email: admin.email, emailVerified: false }) },
        async (app) => {
          await setupAdmin(app);
          const r = await ssoLogin(app);
          expect(r.status).toBe(409);
          expect(r.json.error?.code).toBe("email_taken");
        },
      );
    });

    it("refuses a callback without the sign-in cookie", async () => {
      await withApp({ oidc: fakeOidc(claims) }, async (app) => {
        const r = await call(app, "GET", "/api/auth/oidc/callback?code=abc&state=state");
        expect(r.status).toBe(400);
        expect(r.json.error?.code).toBe("oidc_state");
      });
    });
  });
});
