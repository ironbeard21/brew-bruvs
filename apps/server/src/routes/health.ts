// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

const healthz = createRoute({
  method: "get",
  path: "/healthz",
  tags: ["system"],
  summary: "Liveness check",
  responses: {
    200: {
      description: "The server is up",
      content: {
        "application/json": { schema: z.object({ status: z.literal("ok") }).openapi("Health") },
      },
    },
  },
});

export function registerHealthRoutes(app: OpenAPIHono) {
  app.openapi(healthz, (c) => c.json({ status: "ok" as const }, 200));
}
