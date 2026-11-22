// SPDX-License-Identifier: AGPL-3.0-or-later
// First-run setup, sign-up, login/logout, settings, password reset, tokens, invites, OIDC login.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { type AppEnv, requireSession, SESSION_COOKIE } from "../auth/middleware.ts";
import type { Oidc } from "../auth/oidc.ts";
import { clientIp, enforce, RateLimiter } from "../auth/rate-limit.ts";
import { ApiError, errorResponses } from "../errors.ts";
import type { AuthService, PublicUser } from "../services/auth.ts";

const OIDC_COOKIE = "bb_oidc";
const MINUTE = 60_000;

export interface AuthRouteDeps {
  auth: AuthService;
  oidc: Oidc | undefined;
  baseUrl: string;
  signupMode: "open" | "invite";
  /** Read the client address from X-Forwarded-For (TRUST_PROXY). */
  trustProxy: boolean;
}

const UserSchema = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    email: z.string(),
    displayName: z.string(),
    isAdmin: z.boolean(),
    units: z.enum(["us", "metric"]).openapi({ description: "Display units; data is stored in SI" }),
  })
  .openapi("User");

const password = z.string().min(8).max(256);

const SignedInSchema = z
  .object({
    user: UserSchema,
    token: z.string().optional().openapi({ description: 'App token; only when client is "app"' }),
  })
  .openapi("SignedIn");

const client = z
  .enum(["web", "app"])
  .default("web")
  .openapi({ description: "web: session cookie. app: a revocable token in the response body." });

const accountFields = {
  email: z.email().max(254),
  password,
  displayName: z.string().trim().min(1).max(100),
  client,
  deviceName: z.string().max(100).optional(),
};

const TokenSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["session", "app", "personal"]),
    name: z.string().nullable(),
    scopes: z.array(z.string()),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .openapi("Token");

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

const routes = {
  status: createRoute({
    method: "get",
    path: "/api/auth/status",
    tags: ["auth"],
    summary: "What the sign-in screen needs to know",
    responses: {
      200: json(
        z
          .object({
            setupNeeded: z.boolean(),
            signupMode: z.enum(["open", "invite"]),
            oidcEnabled: z.boolean(),
          })
          .openapi("AuthStatus"),
        "Server sign-in options",
      ),
    },
  }),
  setup: createRoute({
    method: "post",
    path: "/api/setup",
    tags: ["auth"],
    summary: "First-run setup: create the admin account",
    request: body(z.object(accountFields)),
    responses: {
      201: json(SignedInSchema, "Admin created and signed in"),
      ...errorResponses(400, 409, 429),
    },
  }),
  signup: createRoute({
    method: "post",
    path: "/api/auth/signup",
    tags: ["auth"],
    summary: "Create an account",
    request: body(z.object({ ...accountFields, inviteCode: z.string().optional() })),
    responses: {
      201: json(SignedInSchema, "Account created and signed in"),
      ...errorResponses(400, 403, 409, 429),
    },
  }),
  login: createRoute({
    method: "post",
    path: "/api/auth/login",
    tags: ["auth"],
    summary: "Sign in with email and password",
    request: body(
      z.object({
        email: z.string().min(1),
        password: z.string().min(1),
        client,
        deviceName: accountFields.deviceName,
      }),
    ),
    responses: {
      200: json(SignedInSchema, "Signed in"),
      ...errorResponses(400, 401, 403, 429),
    },
  }),
  passwordReset: createRoute({
    method: "post",
    path: "/api/auth/password-reset",
    tags: ["auth"],
    summary: "Set a new password from an admin's reset link; signs out everywhere",
    request: body(z.object({ token: z.string().min(1).max(200), password })),
    responses: { 204: { description: "Password changed" }, ...errorResponses(400, 429) },
  }),
  logout: createRoute({
    method: "post",
    path: "/api/auth/logout",
    tags: ["auth"],
    summary: "Sign out: revokes the session or app token used for this request",
    responses: { 204: { description: "Signed out" }, ...errorResponses(401) },
  }),
  me: createRoute({
    method: "get",
    path: "/api/me",
    tags: ["auth"],
    summary: "The signed-in user",
    responses: { 200: json(UserSchema, "Current user"), ...errorResponses(401) },
  }),
  updateMe: createRoute({
    method: "patch",
    path: "/api/me",
    tags: ["auth"],
    summary: "Change your display name or units",
    request: body(
      z
        .object({
          displayName: z.string().trim().min(1).max(100).optional(),
          units: z.enum(["us", "metric"]).optional(),
        })
        .refine((v) => v.displayName !== undefined || v.units !== undefined, {
          message: "change at least one field",
        }),
    ),
    responses: { 200: json(UserSchema, "Updated user"), ...errorResponses(400, 401, 403) },
  }),
  changePassword: createRoute({
    method: "post",
    path: "/api/me/password",
    tags: ["auth"],
    summary: "Change your password; signs out your other sessions and apps",
    request: body(z.object({ currentPassword: z.string().min(1).max(256), newPassword: password })),
    responses: {
      204: { description: "Password changed" },
      ...errorResponses(400, 401, 403, 409),
    },
  }),
  listTokens: createRoute({
    method: "get",
    path: "/api/auth/tokens",
    tags: ["auth"],
    summary: "Your app and personal API tokens",
    responses: { 200: json(z.array(TokenSchema), "Live tokens"), ...errorResponses(401) },
  }),
  createToken: createRoute({
    method: "post",
    path: "/api/auth/tokens",
    tags: ["auth"],
    summary: "Create a personal API token",
    request: body(
      z.object({
        name: z.string().trim().min(1).max(100),
        scopes: z.array(z.enum(["read", "write"])).min(1),
      }),
    ),
    responses: {
      201: json(
        TokenSchema.extend({ token: z.string().openapi({ description: "Shown once" }) }).openapi(
          "NewToken",
        ),
        "Token created",
      ),
      ...errorResponses(400, 401, 403),
    },
  }),
  revokeToken: createRoute({
    method: "delete",
    path: "/api/auth/tokens/{id}",
    tags: ["auth"],
    summary: "Revoke one of your tokens",
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: "Revoked" }, ...errorResponses(400, 401, 403, 404) },
  }),
  createInvite: createRoute({
    method: "post",
    path: "/api/invites",
    tags: ["auth"],
    summary: "Create a one-time sign-up invite (admins)",
    responses: {
      201: json(
        z.object({ code: z.string(), expiresAt: z.string() }).openapi("Invite"),
        "Invite created",
      ),
      ...errorResponses(401, 403),
    },
  }),
  oidcLogin: createRoute({
    method: "get",
    path: "/api/auth/oidc/login",
    tags: ["auth"],
    summary: "Start single sign-on (when OIDC is configured)",
    responses: { 302: { description: "Redirect to the sign-in provider" }, ...errorResponses(404) },
  }),
  oidcCallback: createRoute({
    method: "get",
    path: "/api/auth/oidc/callback",
    tags: ["auth"],
    summary: "Where the sign-in provider sends the browser back",
    responses: {
      302: { description: "Signed in; redirect to the app" },
      ...errorResponses(400, 404, 409),
    },
  }),
};

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>, deps: AuthRouteDeps) {
  const { auth, baseUrl } = deps;
  const secure = baseUrl.startsWith("https://");

  async function signIn(
    c: Context<AppEnv>,
    user: PublicUser,
    kind: "web" | "app",
    deviceName?: string,
  ) {
    if (kind === "app") {
      const { secret } = await auth.issueToken(user.id, "app", deviceName);
      return { user, token: secret };
    }
    const { secret } = await auth.issueToken(user.id, "session");
    setCookie(c, SESSION_COOKIE, secret, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: "/",
      maxAge: 30 * 86_400,
    });
    return { user };
  }

  const oidc = () => {
    if (!deps.oidc) throw new ApiError(404, "not_found", "Single sign-on isn't configured");
    return deps.oidc;
  };

  // Every login attempt counts per address; only failures count per account, and a success
  // clears them. Account creation and reset links share a slower per-address limit.
  const loginByIp = new RateLimiter(30, 15 * MINUTE);
  const failuresByAccount = new RateLimiter(10, 15 * MINUTE);
  const accountCreationByIp = new RateLimiter(10, 60 * MINUTE);
  const ip = (c: Context<AppEnv>) => `ip:${clientIp(c, deps.trustProxy)}`;
  const limitAccountCreation = (c: Context<AppEnv>) => {
    const key = ip(c);
    enforce(c, accountCreationByIp, key);
    accountCreationByIp.hit(key);
  };

  app.openapi(routes.status, async (c) =>
    c.json(
      {
        setupNeeded: await auth.setupNeeded(),
        signupMode: deps.signupMode,
        oidcEnabled: Boolean(deps.oidc),
      },
      200,
    ),
  );

  app.openapi(routes.setup, async (c) => {
    limitAccountCreation(c);
    const input = c.req.valid("json");
    const user = await auth.setup(input);
    return c.json(await signIn(c, user, input.client, input.deviceName), 201);
  });

  app.openapi(routes.signup, async (c) => {
    limitAccountCreation(c);
    const input = c.req.valid("json");
    const user = await auth.signup(input);
    return c.json(await signIn(c, user, input.client, input.deviceName), 201);
  });

  app.openapi(routes.login, async (c) => {
    const input = c.req.valid("json");
    const byIp = ip(c);
    const byAccount = `account:${input.email.trim().toLowerCase()}`;
    enforce(c, loginByIp, byIp);
    enforce(c, failuresByAccount, byAccount);
    loginByIp.hit(byIp);
    let user: PublicUser;
    try {
      user = await auth.login(input.email, input.password);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_credentials") {
        failuresByAccount.hit(byAccount);
      }
      throw err;
    }
    failuresByAccount.clear(byAccount);
    return c.json(await signIn(c, user, input.client, input.deviceName), 200);
  });

  app.openapi(routes.passwordReset, async (c) => {
    limitAccountCreation(c);
    const { token, password } = c.req.valid("json");
    await auth.redeemPasswordReset(token, password);
    return c.body(null, 204);
  });

  app.openapi(routes.logout, async (c) => {
    const session = requireSession(c);
    await auth.revoke(session.user.id, session.tokenId);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  app.openapi(routes.me, (c) => {
    const { memberships: _, ...user } = requireSession(c).user;
    return c.json(user, 200);
  });

  app.openapi(routes.updateMe, async (c) => {
    const user = await auth.updateProfile(requireSession(c).user.id, c.req.valid("json"));
    return c.json(user, 200);
  });

  app.openapi(routes.changePassword, async (c) => {
    const session = requireSession(c);
    // An integration's API token must not be able to take over the account.
    if (session.kind === "personal") {
      throw new ApiError(403, "forbidden", "Sign in to change your password");
    }
    const { currentPassword, newPassword } = c.req.valid("json");
    await auth.changePassword(session.user.id, currentPassword, newPassword, session.tokenId);
    return c.body(null, 204);
  });

  app.openapi(routes.listTokens, async (c) => {
    const rows = await auth.listTokens(requireSession(c).user.id);
    return c.json(
      rows.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      })),
      200,
    );
  });

  app.openapi(routes.createToken, async (c) => {
    const session = requireSession(c);
    const { name, scopes } = c.req.valid("json");
    const unique = [...new Set(scopes)];
    const t = await auth.issueToken(session.user.id, "personal", name, unique);
    return c.json(
      {
        id: t.id,
        kind: "personal" as const,
        name,
        scopes: unique,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: null,
        token: t.secret,
      },
      201,
    );
  });

  app.openapi(routes.revokeToken, async (c) => {
    await auth.revoke(requireSession(c).user.id, c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(routes.createInvite, async (c) => {
    const session = requireSession(c);
    if (!session.user.isAdmin)
      throw new ApiError(403, "forbidden", "Only admins can create invites");
    const invite = await auth.createInvite(session.user.id);
    return c.json({ code: invite.code, expiresAt: invite.expiresAt.toISOString() }, 201);
  });

  app.openapi(routes.oidcLogin, async (c) => {
    const { url, cookie } = await oidc().start();
    setCookie(c, OIDC_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: "/api/auth/oidc",
      maxAge: 600,
    });
    return c.redirect(url.href, 302);
  });

  app.openapi(routes.oidcCallback, async (c) => {
    const provider = oidc();
    const cookie = getCookie(c, OIDC_COOKIE);
    if (!cookie) throw new ApiError(400, "oidc_state", "Sign-in expired; try again");
    deleteCookie(c, OIDC_COOKIE, { path: "/api/auth/oidc" });
    // Rebuild the URL from BASE_URL so it matches the registered redirect behind a proxy.
    const reqUrl = new URL(c.req.url);
    const claims = await provider.finish(
      new URL(`${baseUrl}${reqUrl.pathname}${reqUrl.search}`),
      cookie,
    );
    const user = await auth.oidcUser(claims);
    await signIn(c, user, "web");
    return c.redirect(`${baseUrl}/`, 302);
  });
}
