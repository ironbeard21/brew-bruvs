// SPDX-License-Identifier: AGPL-3.0-or-later
// A brewery's activity feed. Events point at what happened (a status change, a reading, a batch,
// an item, a member); the feed looks up names when it is read, so renames show the current name.
import { type Db, schema } from "@brew-bruvs/db";
import { and, desc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ApiError } from "../errors.ts";
import type { User } from "../permissions.ts";
import { signedIn, type Tx } from "./access.ts";

const {
  activityEvents,
  batchStatusChanges,
  batches,
  readings,
  equipmentItems,
  inventoryItems,
  users,
} = schema;

/**
 * Verbs and what their object is:
 * batch_started, batch_moved → batch_status_change · reading_logged → reading ·
 * inventory_used → batch · member_joined → user · item_lent, item_returned → equipment_item.
 */
export type Verb =
  | "batch_started"
  | "batch_moved"
  | "reading_logged"
  | "inventory_used"
  | "member_joined"
  | "item_lent"
  | "item_returned";

/** Records an event when `breweryId` is set; personal things have no feed. */
export async function recordActivity(
  tx: Tx,
  event: {
    breweryId: string | null;
    actorUserId: string;
    verb: Verb;
    objectType: "batch_status_change" | "reading" | "batch" | "user";
    objectId: string;
  },
) {
  const { breweryId, ...rest } = event;
  if (breweryId) await tx.insert(activityEvents).values({ breweryId, ...rest });
}

export function createActivityService(db: Db) {
  const actor = alias(users, "actor");
  const subject = alias(users, "subject");
  const is = (type: string) => eq(activityEvents.objectType, type);

  return {
    /** Newest first; only the brewery's members can read it. */
    async feed(viewer: User | null, breweryId: string, page: { limit: number; offset: number }) {
      const user = signedIn(viewer);
      if (!user.memberships.some((m) => m.breweryId === breweryId)) {
        throw new ApiError(404, "not_found", "Brewery not found");
      }
      const rows = await db
        .select({
          event: activityEvents,
          actorName: actor.displayName,
          status: batchStatusChanges.status,
          batchId: batches.id,
          batchName: batches.name,
          equipmentName: equipmentItems.name,
          inventoryName: inventoryItems.name,
          userName: subject.displayName,
        })
        .from(activityEvents)
        .leftJoin(actor, eq(actor.id, activityEvents.actorUserId))
        .leftJoin(
          batchStatusChanges,
          and(is("batch_status_change"), eq(batchStatusChanges.id, activityEvents.objectId)),
        )
        .leftJoin(readings, and(is("reading"), eq(readings.id, activityEvents.objectId)))
        .leftJoin(
          batches,
          or(
            eq(batches.id, batchStatusChanges.batchId),
            eq(batches.id, readings.batchId),
            and(is("batch"), eq(batches.id, activityEvents.objectId)),
          ),
        )
        .leftJoin(
          equipmentItems,
          and(is("equipment_item"), eq(equipmentItems.id, activityEvents.objectId)),
        )
        .leftJoin(
          inventoryItems,
          and(is("inventory_item"), eq(inventoryItems.id, activityEvents.objectId)),
        )
        .leftJoin(subject, and(is("user"), eq(subject.id, activityEvents.objectId)))
        .where(eq(activityEvents.breweryId, breweryId))
        .orderBy(desc(activityEvents.at), desc(activityEvents.id))
        .limit(page.limit + 1)
        .offset(page.offset);
      return {
        items: rows.slice(0, page.limit).map((r) => ({
          id: r.event.id,
          verb: r.event.verb,
          at: r.event.at.toISOString(),
          actor: r.event.actorUserId
            ? { id: r.event.actorUserId, displayName: r.actorName ?? "" }
            : null,
          object: { type: r.event.objectType, id: r.event.objectId },
          batch: r.batchId ? { id: r.batchId, name: r.batchName as string } : null,
          status: r.status,
          name: r.equipmentName ?? r.inventoryName ?? r.userName ?? null,
        })),
        nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
      };
    },
  };
}

export type ActivityService = ReturnType<typeof createActivityService>;
