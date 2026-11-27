// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import { type AppEnv, requireSession } from "../auth/middleware.ts";
import {
  EquipmentHolderInput,
  EquipmentItem,
  EquipmentItemDetail,
  EquipmentItemInput,
  EquipmentItemPage,
  EquipmentItemPatch,
} from "../contracts/equipment-items.ts";
import { errorResponses } from "../errors.ts";
import type { EquipmentItemService } from "../services/equipment-items.ts";
import { body, json } from "./auth.ts";
import { parseDecimal } from "./recipes.ts";

const common = {
  tags: ["equipment"],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
} satisfies Pick<RouteConfig, "tags" | "security">;
const itemsPath = "/api/equipment";
const itemPath = "/api/equipment/{id}";
const params = z.object({ id: z.uuid() });

const routes = {
  list: createRoute({
    ...common,
    method: "get",
    path: itemsPath,
    operationId: "listEquipmentItems",
    summary: "List personal and brewery equipment you can read",
    request: {
      query: z.strictObject({
        breweryId: z.uuid().optional(),
        limit: z.preprocess(parseDecimal, z.int().min(1).max(100)).default(25),
        offset: z.preprocess(parseDecimal, z.int().nonnegative().max(2_147_483_647)).default(0),
      }),
    },
    responses: {
      200: json(EquipmentItemPage, "Equipment items"),
      ...errorResponses(400, 401, 404),
    },
  }),
  create: createRoute({
    ...common,
    method: "post",
    path: itemsPath,
    operationId: "createEquipmentItem",
    summary: "Add a personal or brewery-owned equipment item",
    request: body(EquipmentItemInput),
    responses: { 201: json(EquipmentItem, "Created"), ...errorResponses(400, 401, 403, 404) },
  }),
  get: createRoute({
    ...common,
    method: "get",
    path: itemPath,
    operationId: "getEquipmentItem",
    summary: "Read an equipment item",
    request: { params },
    responses: {
      200: json(EquipmentItemDetail, "Equipment item"),
      ...errorResponses(400, 401, 404),
    },
  }),
  patch: createRoute({
    ...common,
    method: "patch",
    path: itemPath,
    operationId: "updateEquipmentItem",
    summary: "Edit an equipment item",
    request: { params, ...body(EquipmentItemPatch) },
    responses: { 200: json(EquipmentItem, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
  remove: createRoute({
    ...common,
    method: "delete",
    path: itemPath,
    operationId: "deleteEquipmentItem",
    summary: "Delete an equipment item",
    request: { params },
    responses: { 204: { description: "Deleted" }, ...errorResponses(400, 401, 403, 404) },
  }),
  holder: createRoute({
    ...common,
    method: "put",
    path: "/api/equipment/{id}/holder",
    operationId: "setEquipmentHolder",
    summary: "Lend brewery equipment to a member or mark it returned",
    request: { params, ...body(EquipmentHolderInput) },
    responses: { 200: json(EquipmentItem, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
};

export function registerEquipmentItemRoutes(app: OpenAPIHono<AppEnv>, items: EquipmentItemService) {
  app.openapi(routes.list, async (c) =>
    c.json(await items.list(requireSession(c).user, c.req.valid("query")), 200),
  );
  app.openapi(routes.create, async (c) =>
    c.json(await items.create(requireSession(c).user, c.req.valid("json")), 201),
  );
  app.openapi(routes.get, async (c) =>
    c.json(await items.get(requireSession(c).user, c.req.valid("param").id), 200),
  );
  app.openapi(routes.patch, async (c) =>
    c.json(
      await items.update(requireSession(c).user, c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  );
  app.openapi(routes.remove, async (c) => {
    await items.remove(requireSession(c).user, c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.openapi(routes.holder, async (c) =>
    c.json(
      await items.setHolder(
        requireSession(c).user,
        c.req.valid("param").id,
        c.req.valid("json").heldByUserId,
      ),
      200,
    ),
  );
}
