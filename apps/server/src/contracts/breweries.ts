// SPDX-License-Identifier: AGPL-3.0-or-later
// Breweries: members with roles, invitations, and moving your things into a brewery.

import { z } from "@hono/zod-openapi";

const time = z.iso.datetime({ offset: true });
const place = z.string().trim().min(1).max(100);

export const BreweryRole = z.enum(["owner", "brewer", "member", "viewer"]).openapi("BreweryRole", {
  description:
    "owner: everything, including members and deleting the brewery · brewer: edits brewery recipes and batches · member: logs readings and notes on brewery batches · viewer: reads",
});

const breweryFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2_000).nullable().optional(),
  // Privacy rule: city and state only.
  city: place.nullable().optional(),
  state: place.nullable().optional(),
};

export const BreweryInput = z.strictObject(breweryFields).openapi("BreweryInput");
export const BreweryPatch = z
  .strictObject(breweryFields)
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "change at least one field" })
  .openapi("BreweryPatch");

export const Brewery = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    role: BreweryRole.openapi({ description: "Your role" }),
    createdAt: time,
    updatedAt: time,
  })
  .openapi("Brewery");

export const Member = z
  .object({ userId: z.uuid(), displayName: z.string(), role: BreweryRole, joinedAt: time })
  .openapi("BreweryMember");

export const BreweryDetail = Brewery.extend({ members: z.array(Member) }).openapi("BreweryDetail");
export const BreweryList = z.object({ items: z.array(Brewery) }).openapi("BreweryList");

export const RoleInput = z.strictObject({ role: BreweryRole }).openapi("RoleInput");
export const TransferInput = z
  .strictObject({ userId: z.uuid().openapi({ description: "A member who becomes an owner" }) })
  .openapi("TransferInput");

export const InviteInput = z
  .strictObject({
    role: BreweryRole,
    email: z.email().max(320).optional().openapi({
      description:
        "Whoever signs in here with this email sees the invite. The reply is the same whether or not an account has it. Leave out for a one-time code",
    }),
  })
  .openapi("BreweryInviteInput");

export const Invite = z
  .object({
    id: z.uuid(),
    brewery: z.object({ id: z.uuid(), name: z.string() }),
    role: BreweryRole,
    email: z.string().nullable().openapi({ description: "Null for a code invite" }),
    createdAt: time,
    expiresAt: time,
    code: z.string().optional().openapi({
      description: "A code invite's code. Shown once, when it is created",
    }),
  })
  .openapi("BreweryInvite");
export const InviteList = z.object({ items: z.array(Invite) }).openapi("BreweryInviteList");

export const AcceptInput = z
  .union([z.strictObject({ code: z.string().min(1).max(200) }), z.strictObject({ id: z.uuid() })])
  .openapi("AcceptBreweryInvite", {
    description: "A one-time code, or the id of an invite sent to you",
  });

export const MoveInput = z
  .strictObject({ breweryId: z.uuid() })
  .openapi("MoveToBrewery", { description: "A brewery where you are an owner or brewer" });
export const Owner = z.object({ type: z.enum(["user", "brewery"]), id: z.uuid() }).openapi("Owner");
