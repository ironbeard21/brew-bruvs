// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import { type AppEnv, requireSession } from "../auth/middleware.ts";
import { enforce, RateLimiter } from "../auth/rate-limit.ts";
import { IssuedWebhook, Webhook, WebhookInput } from "../contracts/webhooks.ts";
import { errorResponses } from "../errors.ts";
import type { WebhookService } from "../services/webhooks.ts";
import { body, json } from "./auth.ts";

const common = {
  tags: ["webhooks"],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
} satisfies Pick<RouteConfig, "tags" | "security">;
const base = "/api/integrations/webhooks";
const params = z.object({ id: z.uuid() });

const routes = {
  list: createRoute({
    ...common,
    method: "get",
    path: base,
    operationId: "listWebhooks",
    request: { query: z.strictObject({ breweryId: z.uuid().optional() }) },
    responses: {
      200: json(z.object({ items: z.array(Webhook) }), "Webhooks"),
      ...errorResponses(400, 401, 403, 404),
    },
  }),
  create: createRoute({
    ...common,
    method: "post",
    path: base,
    operationId: "createWebhook",
    request: body(WebhookInput),
    responses: {
      201: json(IssuedWebhook, "Created. Save the signing key."),
      ...errorResponses(400, 401, 403, 404),
    },
  }),
  test: createRoute({
    ...common,
    method: "post",
    path: "/api/integrations/webhooks/{id}/test",
    operationId: "testWebhook",
    request: { params },
    responses: {
      202: json(z.object({ queued: z.literal(true) }), "Queued test delivery"),
      ...errorResponses(400, 401, 403, 404, 429),
    },
  }),
  remove: createRoute({
    ...common,
    method: "delete",
    path: "/api/integrations/webhooks/{id}",
    operationId: "deleteWebhook",
    request: { params },
    responses: { 204: { description: "Deleted" }, ...errorResponses(400, 401, 403, 404) },
  }),
};

export function registerWebhookRoutes(app: OpenAPIHono<AppEnv>, hooks: WebhookService) {
  const testSends = new RateLimiter(5, 5 * 60_000);
  app.openapi(routes.list, async (c) =>
    c.json(await hooks.list(requireSession(c).user, c.req.valid("query").breweryId), 200),
  );
  app.openapi(routes.create, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await hooks.create(requireSession(c).user, c.req.valid("json")), 201);
  });
  app.openapi(routes.test, async (c) => {
    const { user } = requireSession(c);
    enforce(c, testSends, user.id);
    testSends.hit(user.id);
    await hooks.test(user, c.req.valid("param").id);
    return c.json({ queued: true as const }, 202);
  });
  app.openapi(routes.remove, async (c) => {
    await hooks.remove(requireSession(c).user, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
