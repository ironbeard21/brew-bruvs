// SPDX-License-Identifier: AGPL-3.0-or-later
// Server admin: list accounts, disable and re-enable them, create password reset links.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AppEnv, requireSession } from "../auth/middleware.ts";
import { ApiError, errorResponses } from "../errors.ts";
import type { AdminUser, AuthService, Session } from "../services/auth.ts";
import { json } from "./auth.ts";

const AdminUserSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    isAdmin: z.boolean(),
    disabled: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("AdminUser");

const userId = { params: z.object({ id: z.uuid() }) };
const setDisabled = (path: string, summary: string) =>
  createRoute({
    method: "post",
    path,
    tags: ["admin"],
    summary,
    request: userId,
    responses: {
      200: json(AdminUserSchema, "Updated user"),
      ...errorResponses(400, 401, 403, 404, 409),
    },
  });

const routes = {
  listUsers: createRoute({
    method: "get",
    path: "/api/admin/users",
    tags: ["admin"],
    summary: "Every account on this server",
    responses: { 200: json(z.array(AdminUserSchema), "Accounts"), ...errorResponses(401, 403) },
  }),
  disable: setDisabled(
    "/api/admin/users/{id}/disable",
    "Disable an account: it can't sign in and its tokens stop working",
  ),
  enable: setDisabled("/api/admin/users/{id}/enable", "Re-enable a disabled account"),
  passwordReset: createRoute({
    method: "post",
    path: "/api/admin/users/{id}/password-reset",
    tags: ["admin"],
    summary: "Create a one-time password reset link to give to the user (valid 24 hours)",
    request: userId,
    responses: {
      201: json(
        z
          .object({
            url: z.string().openapi({
              description: "Open in the app; the token is after # so it never reaches server logs",
            }),
            expiresAt: z.string(),
          })
          .openapi("PasswordResetLink"),
        "Reset link created",
      ),
      ...errorResponses(400, 401, 403, 404),
    },
  }),
};

function requireAdmin(c: Context<AppEnv>): Session {
  const session = requireSession(c);
  if (!session.user.isAdmin) throw new ApiError(403, "forbidden", "Only admins can do this");
  return session;
}

const view = (u: AdminUser) => ({ ...u, createdAt: u.createdAt.toISOString() });

export function registerAdminRoutes(
  app: OpenAPIHono<AppEnv>,
  deps: { auth: AuthService; baseUrl: string },
) {
  const { auth, baseUrl } = deps;

  app.openapi(routes.listUsers, async (c) => {
    requireAdmin(c);
    return c.json((await auth.listUsers()).map(view), 200);
  });

  app.openapi(routes.disable, async (c) => {
    const admin = requireAdmin(c);
    return c.json(view(await auth.setDisabled(admin.user.id, c.req.valid("param").id, true)), 200);
  });

  app.openapi(routes.enable, async (c) => {
    const admin = requireAdmin(c);
    return c.json(view(await auth.setDisabled(admin.user.id, c.req.valid("param").id, false)), 200);
  });

  app.openapi(routes.passwordReset, async (c) => {
    const admin = requireAdmin(c);
    const reset = await auth.createPasswordReset(admin.user.id, c.req.valid("param").id);
    return c.json(
      {
        url: `${baseUrl}/reset-password#token=${reset.token}`,
        expiresAt: reset.expiresAt.toISOString(),
      },
      201,
    );
  });
}
