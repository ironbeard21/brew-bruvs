// SPDX-License-Identifier: AGPL-3.0-or-later
// Breweries, members, invites, and moving your recipes, batches, notes and equipment profiles in.
// Everything here needs a session; only a brewery's members can see it.
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import {
  AcceptInput,
  BreweryDetail,
  BreweryInput,
  BreweryList,
  BreweryPatch,
  Invite,
  InviteInput,
  InviteList,
  MoveInput,
  Owner,
  RoleInput,
  TransferInput,
} from "../contracts/breweries.ts";
import { errorResponses } from "../errors.ts";
import type { BreweryService } from "../services/breweries.ts";
import { body, json } from "./auth.ts";

const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
const brewery = { tags: ["breweries"], security } satisfies Pick<RouteConfig, "tags" | "security">;
const id = z.object({ id: z.uuid() });
const member = z.object({ id: z.uuid(), userId: z.uuid() });
const invite = z.object({ id: z.uuid(), inviteId: z.uuid() });
const done = { 204: { description: "Done" } };

const routes = {
  list: createRoute({
    ...brewery,
    method: "get",
    path: "/api/breweries",
    operationId: "listBreweries",
    summary: "The breweries you belong to",
    responses: { 200: json(BreweryList, "Breweries"), ...errorResponses(401) },
  }),
  create: createRoute({
    ...brewery,
    method: "post",
    path: "/api/breweries",
    operationId: "createBrewery",
    summary: "Create a brewery; you are its first owner",
    request: body(BreweryInput),
    responses: { 201: json(BreweryDetail, "Created"), ...errorResponses(400, 401) },
  }),
  get: createRoute({
    ...brewery,
    method: "get",
    path: "/api/breweries/{id}",
    operationId: "getBrewery",
    summary: "A brewery and its members",
    request: { params: id },
    responses: { 200: json(BreweryDetail, "Brewery"), ...errorResponses(400, 401, 404) },
  }),
  update: createRoute({
    ...brewery,
    method: "patch",
    path: "/api/breweries/{id}",
    operationId: "updateBrewery",
    summary: "Rename or describe a brewery (owners)",
    request: { params: id, ...body(BreweryPatch) },
    responses: { 200: json(BreweryDetail, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
  delete: createRoute({
    ...brewery,
    method: "delete",
    path: "/api/breweries/{id}",
    operationId: "deleteBrewery",
    summary: "Delete an empty brewery (owners)",
    request: { params: id },
    responses: { ...done, ...errorResponses(400, 401, 403, 404, 409) },
  }),
  setRole: createRoute({
    ...brewery,
    method: "put",
    path: "/api/breweries/{id}/members/{userId}/role",
    operationId: "setBreweryRole",
    summary: "Change a member's role (owners); the last owner can't step down",
    request: { params: member, ...body(RoleInput) },
    responses: { 200: json(BreweryDetail, "Updated"), ...errorResponses(400, 401, 403, 404, 409) },
  }),
  removeMember: createRoute({
    ...brewery,
    method: "delete",
    path: "/api/breweries/{id}/members/{userId}",
    operationId: "removeBreweryMember",
    summary: "Remove a member (owners), or leave with your own id",
    request: { params: member },
    responses: { ...done, ...errorResponses(400, 401, 403, 404, 409) },
  }),
  transfer: createRoute({
    ...brewery,
    method: "post",
    path: "/api/breweries/{id}/transfer",
    operationId: "transferBrewery",
    summary: "Make another member an owner and yourself a brewer (owners)",
    request: { params: id, ...body(TransferInput) },
    responses: { 200: json(BreweryDetail, "Transferred"), ...errorResponses(400, 401, 403, 404) },
  }),
  invite: createRoute({
    ...brewery,
    method: "post",
    path: "/api/breweries/{id}/invites",
    operationId: "inviteToBrewery",
    summary: "Invite someone on this server by email, or make a one-time code (owners)",
    request: { params: id, ...body(InviteInput) },
    responses: { 201: json(Invite, "Invite"), ...errorResponses(400, 401, 403, 404, 409) },
  }),
  invites: createRoute({
    ...brewery,
    method: "get",
    path: "/api/breweries/{id}/invites",
    operationId: "listBreweryInvites",
    summary: "The brewery's pending invites (owners)",
    request: { params: id },
    responses: { 200: json(InviteList, "Invites"), ...errorResponses(400, 401, 403, 404) },
  }),
  revokeInvite: createRoute({
    ...brewery,
    method: "delete",
    path: "/api/breweries/{id}/invites/{inviteId}",
    operationId: "revokeBreweryInvite",
    summary: "Cancel a pending invite (owners)",
    request: { params: invite },
    responses: { ...done, ...errorResponses(400, 401, 403, 404) },
  }),
  myInvites: createRoute({
    ...brewery,
    method: "get",
    path: "/api/brewery-invites",
    operationId: "listMyBreweryInvites",
    summary: "Pending brewery invites sent to you",
    responses: { 200: json(InviteList, "Invites"), ...errorResponses(401) },
  }),
  accept: createRoute({
    ...brewery,
    method: "post",
    path: "/api/brewery-invites/accept",
    operationId: "acceptBreweryInvite",
    summary: "Join a brewery with a one-time code or an invite sent to you",
    request: body(AcceptInput),
    responses: { 200: json(BreweryDetail, "Joined"), ...errorResponses(400, 401, 404, 409) },
  }),
  decline: createRoute({
    ...brewery,
    method: "delete",
    path: "/api/brewery-invites/{id}",
    operationId: "declineBreweryInvite",
    summary: "Decline an invite sent to you",
    request: { params: id },
    responses: { ...done, ...errorResponses(400, 401, 404) },
  }),
};

const MOVES = {
  recipe: ["/api/recipes/{id}/move", "moveRecipe", "recipes"],
  batch: ["/api/batches/{id}/move", "moveBatch", "batches"],
  note: ["/api/notes/{id}/move", "moveNote", "notes"],
  equipment_profile: [
    "/api/equipment-profiles/{id}/move",
    "moveEquipmentProfile",
    "equipment profiles",
  ],
} as const;

const viewer = (c: Context<AppEnv>) => c.get("session")?.user ?? null;

export function registerBreweryRoutes(app: OpenAPIHono<AppEnv>, breweries: BreweryService) {
  app.openapi(routes.list, async (c) => c.json(await breweries.list(viewer(c)), 200));
  app.openapi(routes.create, async (c) =>
    c.json(await breweries.create(viewer(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.get, async (c) =>
    c.json(await breweries.get(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.update, async (c) =>
    c.json(await breweries.update(viewer(c), c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(routes.delete, async (c) => {
    await breweries.remove(viewer(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.openapi(routes.setRole, async (c) => {
    const p = c.req.valid("param");
    return c.json(
      await breweries.setRole(viewer(c), p.id, p.userId, c.req.valid("json").role),
      200,
    );
  });
  app.openapi(routes.removeMember, async (c) => {
    const p = c.req.valid("param");
    await breweries.removeMember(viewer(c), p.id, p.userId);
    return c.body(null, 204);
  });
  app.openapi(routes.transfer, async (c) =>
    c.json(
      await breweries.transfer(viewer(c), c.req.valid("param").id, c.req.valid("json").userId),
      200,
    ),
  );
  app.openapi(routes.invite, async (c) =>
    c.json(await breweries.invite(viewer(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(routes.invites, async (c) =>
    c.json(await breweries.invites(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.revokeInvite, async (c) => {
    const p = c.req.valid("param");
    await breweries.revokeInvite(viewer(c), p.id, p.inviteId);
    return c.body(null, 204);
  });
  app.openapi(routes.myInvites, async (c) => c.json(await breweries.myInvites(viewer(c)), 200));
  app.openapi(routes.accept, async (c) =>
    c.json(await breweries.accept(viewer(c), c.req.valid("json")), 200),
  );
  app.openapi(routes.decline, async (c) => {
    await breweries.decline(viewer(c), c.req.valid("param").id);
    return c.body(null, 204);
  });

  for (const [type, [path, operationId, tag]] of Object.entries(MOVES) as [
    keyof typeof MOVES,
    (typeof MOVES)[keyof typeof MOVES],
  ][]) {
    const route = createRoute({
      tags: [tag],
      security,
      method: "post",
      path,
      operationId,
      summary: `Move something you own into a brewery where you are an owner or brewer`,
      request: { params: id, ...body(MoveInput) },
      responses: {
        200: json(z.object({ owner: Owner }), "Moved"),
        ...errorResponses(400, 401, 403, 404),
      },
    });
    app.openapi(route, async (c) => {
      const owner = await breweries.move(
        viewer(c),
        type,
        c.req.valid("param").id,
        c.req.valid("json").breweryId,
      );
      return c.json({ owner }, 200);
    });
  }
}
