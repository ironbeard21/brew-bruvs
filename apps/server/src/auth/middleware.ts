// SPDX-License-Identifier: AGPL-3.0-or-later
// Resolves the caller from `Authorization: Bearer <token>` or the web session cookie.
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { ApiError } from "../errors.ts";
import type { AuthService, Session } from "../services/auth.ts";

export const SESSION_COOKIE = "bb_session";

export type AppEnv = { Variables: { session: Session | null } };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function sessionMiddleware(auth: AuthService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    const secret = header?.startsWith("Bearer ")
      ? header.slice(7).trim()
      : getCookie(c, SESSION_COOKIE);
    const session = secret ? await auth.resolve(secret) : null;
    // Personal API tokens need the "write" scope for anything but reads.
    if (
      session?.kind === "personal" &&
      !READ_METHODS.has(c.req.method) &&
      !session.scopes.includes("write")
    ) {
      throw new ApiError(403, "insufficient_scope", "This token is read-only");
    }
    c.set("session", session);
    await next();
  };
}

export function requireSession(c: Context<AppEnv>): Session {
  const session = c.get("session");
  if (!session) throw new ApiError(401, "unauthorized", "Sign in first");
  return session;
}
