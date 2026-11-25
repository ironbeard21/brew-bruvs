// SPDX-License-Identifier: AGPL-3.0-or-later
// Visibility and share routes for batches, notes, inventory, equipment and equipment profiles
// (recipes have their own), and a brewery's activity feed.
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import { BatchStatus } from "../contracts/batches.ts";
import { Share, ShareInput, Visibility } from "../contracts/recipes.ts";
import { errorResponses } from "../errors.ts";
import type { ActivityService } from "../services/activity.ts";
import type { SharedType, SharingService } from "../services/sharing.ts";
import { body, json } from "./auth.ts";
import { parseDecimal } from "./recipes.ts";

const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
const id = z.object({ id: z.uuid() });
const shareId = z.object({ id: z.uuid(), shareId: z.uuid() });

const VisibilityInput = z.strictObject({ visibility: Visibility }).openapi("VisibilityInput");
const VisibilityResult = z
  .object({ id: z.uuid(), visibility: Visibility })
  .openapi("VisibilityResult");

const ActivityEvent = z
  .object({
    id: z.uuid(),
    verb: z.string().openapi({
      description:
        "batch_started, batch_moved, reading_logged, inventory_used, member_joined, item_lent, item_returned",
    }),
    at: z.iso.datetime({ offset: true }),
    actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
    object: z.object({ type: z.string(), id: z.uuid() }),
    batch: z
      .object({ id: z.uuid(), name: z.string() })
      .nullable()
      .openapi({ description: "The batch it is about, if any and still there" }),
    status: BatchStatus.nullable().openapi({ description: "For batch_started and batch_moved" }),
    name: z.string().nullable().openapi({ description: "The item's or member's name" }),
  })
  .openapi("ActivityEvent");
const ActivityPage = z
  .object({ items: z.array(ActivityEvent), nextOffset: z.int().nullable() })
  .openapi("ActivityPage");

/** Path segment, operation id stem and tag for each shareable type. */
const TYPES: Record<SharedType, [string, string, string]> = {
  batch: ["batches", "Batch", "batches"],
  note: ["notes", "Note", "notes"],
  inventory_item: ["inventory", "InventoryItem", "inventory"],
  equipment_item: ["equipment", "EquipmentItem", "equipment"],
  equipment_profile: ["equipment-profiles", "EquipmentProfile", "equipment profiles"],
};

const viewer = (c: Context<AppEnv>) => c.get("session")?.user ?? null;

export function registerSharingRoutes(
  app: OpenAPIHono<AppEnv>,
  deps: { sharing: SharingService; activity: ActivityService },
) {
  const { sharing, activity } = deps;

  for (const [type, [segment, name, tag]] of Object.entries(TYPES) as [
    SharedType,
    [string, string, string],
  ][]) {
    const base = { tags: [tag], security };
    const path = `/api/${segment}/{id}`;
    app.openapi(
      createRoute({
        ...base,
        method: "put",
        path: `${path}/visibility`,
        operationId: `set${name}Visibility`,
        summary: "Who can see it: private, unlisted (by link), server, or public",
        request: { params: id, ...body(VisibilityInput) },
        responses: {
          200: json(VisibilityResult, "Updated"),
          ...errorResponses(400, 401, 403, 404),
        },
      }),
      async (c) =>
        c.json(
          await sharing.setVisibility(
            viewer(c),
            type,
            c.req.valid("param").id,
            c.req.valid("json").visibility,
          ),
          200,
        ),
    );
    app.openapi(
      createRoute({
        ...base,
        method: "get",
        path: `${path}/shares`,
        operationId: `list${name}Shares`,
        summary: "People and breweries it is shared with",
        request: { params: id },
        responses: { 200: json(z.array(Share), "Shares"), ...errorResponses(400, 401, 403, 404) },
      }),
      async (c) => c.json(await sharing.list(viewer(c), type, c.req.valid("param").id), 200),
    );
    app.openapi(
      createRoute({
        ...base,
        method: "post",
        path: `${path}/shares`,
        operationId: `share${name}`,
        summary: "Share with a user (by email) or a brewery; sharing again changes the level",
        request: { params: id, ...body(ShareInput) },
        responses: { 201: json(Share, "Shared"), ...errorResponses(400, 401, 403, 404) },
      }),
      async (c) =>
        c.json(
          await sharing.share(viewer(c), type, c.req.valid("param").id, c.req.valid("json")),
          201,
        ),
    );
    app.openapi(
      createRoute({
        ...base,
        method: "delete",
        path: `${path}/shares/{shareId}`,
        operationId: `unshare${name}`,
        summary: "Stop sharing",
        request: { params: shareId },
        responses: { 204: { description: "Done" }, ...errorResponses(400, 401, 403, 404) },
      }),
      async (c) => {
        const p = c.req.valid("param");
        await sharing.unshare(viewer(c), type, p.id, p.shareId);
        return c.body(null, 204);
      },
    );
  }

  app.openapi(
    createRoute({
      tags: ["breweries"],
      security,
      method: "get",
      path: "/api/breweries/{id}/activity",
      operationId: "getBreweryActivity",
      summary: "What happened in a brewery, newest first (members only)",
      request: {
        params: id,
        query: z.strictObject({
          limit: z.preprocess(parseDecimal, z.int().min(1).max(100)).default(25),
          offset: z.preprocess(parseDecimal, z.int().nonnegative().max(2_147_483_647)).default(0),
        }),
      },
      responses: { 200: json(ActivityPage, "Activity"), ...errorResponses(400, 401, 404) },
    }),
    async (c) =>
      c.json(await activity.feed(viewer(c), c.req.valid("param").id, c.req.valid("query")), 200),
  );
}
