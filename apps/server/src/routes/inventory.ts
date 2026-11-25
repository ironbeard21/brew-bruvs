// SPDX-License-Identifier: AGPL-3.0-or-later
// Inventory items, low stock and the shopping list. Everything here needs a session.
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import {
  CreateInventoryItem,
  InventoryItem,
  InventoryItemPatch,
  InventoryPage,
  InventoryScope,
  ShoppingList,
} from "../contracts/inventory.ts";
import { errorResponses } from "../errors.ts";
import type { InventoryService } from "../services/inventory.ts";
import { body, json } from "./auth.ts";
import { parseDecimal } from "./recipes.ts";

const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
const inventory = { tags: ["inventory"], security } satisfies Pick<
  RouteConfig,
  "tags" | "security"
>;
const id = z.object({ id: z.uuid() });

const routes = {
  list: createRoute({
    ...inventory,
    method: "get",
    path: "/api/inventory",
    operationId: "listInventory",
    summary: "Your inventory or a brewery's, by name",
    request: {
      query: z.strictObject({
        ...InventoryScope,
        q: z.string().trim().min(1).max(100).optional().openapi({
          description: "Search name, catalog id, lot and location",
        }),
        limit: z.preprocess(parseDecimal, z.int().min(1).max(100)).default(50),
        offset: z.preprocess(parseDecimal, z.int().nonnegative().max(2_147_483_647)).default(0),
      }),
    },
    responses: { 200: json(InventoryPage, "Items"), ...errorResponses(400, 401, 404) },
  }),
  create: createRoute({
    ...inventory,
    method: "post",
    path: "/api/inventory",
    operationId: "createInventoryItem",
    summary: "Add an item to your inventory or a brewery's",
    request: body(CreateInventoryItem),
    responses: { 201: json(InventoryItem, "Created"), ...errorResponses(400, 401, 403, 404) },
  }),
  lowStock: createRoute({
    ...inventory,
    method: "get",
    path: "/api/inventory/low-stock",
    operationId: "listLowStock",
    summary: "Items with less available than their low-stock threshold",
    request: { query: z.strictObject(InventoryScope) },
    responses: {
      200: json(z.object({ items: z.array(InventoryItem) }), "Items"),
      ...errorResponses(400, 401, 404),
    },
  }),
  shopping: createRoute({
    ...inventory,
    method: "get",
    path: "/api/inventory/shopping-list",
    operationId: "getShoppingList",
    summary: "What planned batches are short of, plus items below their threshold",
    request: { query: z.strictObject(InventoryScope) },
    responses: { 200: json(ShoppingList, "Shopping list"), ...errorResponses(400, 401, 404) },
  }),
  get: createRoute({
    ...inventory,
    method: "get",
    path: "/api/inventory/{id}",
    operationId: "getInventoryItem",
    summary: "One inventory item",
    request: { params: id },
    responses: { 200: json(InventoryItem, "Item"), ...errorResponses(400, 404) },
  }),
  update: createRoute({
    ...inventory,
    method: "patch",
    path: "/api/inventory/{id}",
    operationId: "updateInventoryItem",
    summary: "Change an inventory item",
    request: { params: id, ...body(InventoryItemPatch) },
    responses: { 200: json(InventoryItem, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
  delete: createRoute({
    ...inventory,
    method: "delete",
    path: "/api/inventory/{id}",
    operationId: "deleteInventoryItem",
    summary: "Delete an inventory item and any reservations of it",
    request: { params: id },
    responses: { 204: { description: "Deleted" }, ...errorResponses(400, 401, 403, 404) },
  }),
};

const viewer = (c: Context<AppEnv>) => c.get("session")?.user ?? null;

export function registerInventoryRoutes(app: OpenAPIHono<AppEnv>, items: InventoryService) {
  app.openapi(routes.list, async (c) =>
    c.json(await items.list(viewer(c), c.req.valid("query")), 200),
  );
  app.openapi(routes.create, async (c) =>
    c.json(await items.create(viewer(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.lowStock, async (c) =>
    c.json(await items.lowStock(viewer(c), c.req.valid("query").breweryId), 200),
  );
  app.openapi(routes.shopping, async (c) =>
    c.json(await items.shoppingList(viewer(c), c.req.valid("query").breweryId), 200),
  );
  app.openapi(routes.get, async (c) =>
    c.json(await items.get(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.update, async (c) =>
    c.json(await items.update(viewer(c), c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(routes.delete, async (c) => {
    await items.remove(viewer(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
}
