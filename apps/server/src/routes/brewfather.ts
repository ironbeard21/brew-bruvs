// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AppEnv, requireSession } from "../auth/middleware.ts";
import { enforce, RateLimiter } from "../auth/rate-limit.ts";
import { BrewfatherCredentials, BrewfatherImport } from "../contracts/brewfather.ts";
import { ApiError, errorBody, errorResponses } from "../errors.ts";
import type { BatchService } from "../services/batches.ts";
import type { BrewfatherService } from "../services/brewfather.ts";
import type { InventoryService } from "../services/inventory.ts";
import type { RecipeService } from "../services/recipes.ts";
import { body, json } from "./auth.ts";

const base = {
  tags: ["integrations"],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
  method: "post" as const,
};

const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireSession(c);
  await next();
};

function limit(maxSize: number) {
  return bodyLimit({
    maxSize,
    onError: (c) =>
      c.json(errorBody("request_too_large", "Brewfather import request is too large"), 413),
  });
}

const preview = createRoute({
  ...base,
  path: "/api/integrations/brewfather/preview",
  operationId: "previewBrewfatherImport",
  summary: "Fetch Brewfather data for review using a one-time API key",
  middleware: [session, limit(4 * 1024)],
  request: body(BrewfatherCredentials),
  responses: {
    200: json(BrewfatherImport, "Recipes, batches and inventory to review before saving"),
    ...errorResponses(400, 401, 403, 413, 422, 429, 502),
  },
});

const save = createRoute({
  ...base,
  path: "/api/integrations/brewfather/import",
  operationId: "saveBrewfatherImport",
  summary: "Save a reviewed Brewfather import without credentials",
  middleware: [session, limit(24 * 1024 * 1024)],
  request: body(BrewfatherImport),
  responses: {
    201: json(
      z.strictObject({
        recipeIds: z.array(z.uuid()),
        batchIds: z.array(z.uuid()),
        inventoryIds: z.array(z.uuid()),
      }),
      "IDs of newly imported records",
    ),
    ...errorResponses(400, 401, 403, 413, 429),
  },
});

export function registerBrewfatherRoutes(
  app: OpenAPIHono<AppEnv>,
  services: {
    brewfather: BrewfatherService;
    recipes: RecipeService;
    batches: BatchService;
    inventory: InventoryService;
  },
) {
  const previews = new RateLimiter(5, 60 * 60_000);
  const imports = new RateLimiter(5, 60 * 60_000);
  let active = 0;
  app.openapi(preview, async (c) => {
    const { user } = requireSession(c);
    enforce(c, previews, user.id);
    if (active >= 2) {
      c.header("Retry-After", "10");
      throw new ApiError(429, "import_busy", "Brewfather imports are busy. Try again shortly.");
    }
    previews.hit(user.id);
    active++;
    c.header("Cache-Control", "no-store");
    try {
      return c.json(await services.brewfather.preview(user, c.req.valid("json")), 200);
    } finally {
      active--;
    }
  });
  app.openapi(save, async (c) => {
    const { user } = requireSession(c);
    enforce(c, imports, user.id);
    imports.hit(user.id);
    return c.json(await services.brewfather.save(user, c.req.valid("json"), services), 201);
  });
}
