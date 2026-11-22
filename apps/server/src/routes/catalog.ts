// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { type AppEnv, SESSION_COOKIE } from "../auth/middleware.ts";
import {
  CatalogAttribution,
  CatalogItem,
  CatalogNameSchema,
  CatalogPage,
} from "../contracts/catalog.ts";
import { ApiError, errorResponses } from "../errors.ts";
import { can } from "../permissions.ts";
import type { CatalogService } from "../services/catalog.ts";

const catalogRead: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (
    !can(c.get("session")?.user ?? null, "read", { owner: null, visibility: "server", shares: [] })
  ) {
    throw new ApiError(401, "unauthorized", "Sign in first");
  }
  await next();
};

const common = {
  method: "get",
  tags: ["catalog"],
  middleware: [catalogRead],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
} satisfies Pick<RouteConfig, "method" | "tags" | "middleware" | "security">;

const parseDecimal = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;

const sourcesRoute = createRoute({
  ...common,
  path: "/api/catalog/sources",
  operationId: "getCatalogSources",
  summary: "Get catalog sources and attribution",
  request: { query: z.strictObject({}) },
  responses: {
    200: {
      description: "Catalog attribution",
      content: { "application/json": { schema: CatalogAttribution } },
    },
    ...errorResponses(400, 401),
  },
});

const listRoute = createRoute({
  ...common,
  path: "/api/catalog/{catalog}",
  operationId: "listCatalogItems",
  summary: "Search catalog items by name or alias",
  request: {
    params: z.object({ catalog: CatalogNameSchema }),
    query: z.strictObject({
      q: z.string().trim().min(1).max(200).optional(),
      limit: z.preprocess(parseDecimal, z.int().min(1).max(100)).default(25),
      offset: z.preprocess(parseDecimal, z.int().nonnegative().max(2_147_483_647)).default(0),
    }),
  },
  responses: {
    200: {
      description: "Matching catalog items ordered by name and ID",
      content: { "application/json": { schema: CatalogPage } },
    },
    ...errorResponses(400, 401),
  },
});

const detailRoute = createRoute({
  ...common,
  path: "/api/catalog/{catalog}/{id}",
  operationId: "getCatalogItem",
  summary: "Get a catalog item with its sources and licenses",
  request: {
    params: z.object({
      catalog: CatalogNameSchema,
      id: z
        .string()
        .max(200)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    }),
    query: z.strictObject({}),
  },
  responses: {
    200: { description: "Catalog item", content: { "application/json": { schema: CatalogItem } } },
    ...errorResponses(400, 401, 404),
  },
});

export function registerCatalogRoutes(app: OpenAPIHono<AppEnv>, catalog: CatalogService) {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: SESSION_COOKIE,
  });

  app.openapi(sourcesRoute, async (c) => c.json(await catalog.attribution(), 200));
  app.openapi(listRoute, async (c) =>
    c.json(await catalog.list(c.req.valid("param").catalog, c.req.valid("query")), 200),
  );
  app.openapi(detailRoute, async (c) => {
    const { catalog: name, id } = c.req.valid("param");
    return c.json(await catalog.get(name, id), 200);
  });
}
