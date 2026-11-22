// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared access helpers for owned objects (recipes, batches, notes, equipment profiles):
// the per-object check through can(), and the SQL filter that mirrors it for lists.
import { type Db, schema } from "@brew-bruvs/db";
import { and, eq, exists, inArray, or, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ApiError } from "../errors.ts";
import { type Action, can, type Resource, type User } from "../permissions.ts";

const { shares } = schema;

export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ShareableType = (typeof shares.$inferSelect)["resourceType"];

export const newId = async (tx: Tx) =>
  (await tx.execute<{ id: string }>(sql`SELECT uuidv7() AS id`)).rows[0]?.id as string;

export function ownerOf(row: {
  ownerUserId: string | null;
  ownerBreweryId: string | null;
}): Resource["owner"] {
  if (row.ownerUserId) return { type: "user", id: row.ownerUserId };
  return row.ownerBreweryId ? { type: "brewery", id: row.ownerBreweryId } : null;
}

export function signedIn(user: User | null): User {
  if (!user) throw new ApiError(401, "unauthorized", "Sign in first");
  return user;
}

/** Reading something you can't see is "not found", so private objects don't leak. */
export function denied(user: User | null, action: Action, resource: Resource, what: string) {
  if (!can(user, "read", resource)) return new ApiError(404, "not_found", `${what} not found`);
  if (!can(user, action, resource)) {
    return new ApiError(403, "forbidden", `You can't ${action} this ${what.toLowerCase()}`);
  }
  return null;
}

/** Checks `action` on a loaded row with its shares; throws 404 or 403. */
export async function authorizeRow(
  tx: Tx,
  user: User | null,
  action: Action,
  type: ShareableType,
  row: { id: string; ownerUserId: string | null; ownerBreweryId: string | null } & {
    visibility: Resource["visibility"];
  },
  what: string,
) {
  const grants = await tx
    .select()
    .from(shares)
    .where(and(eq(shares.resourceType, type), eq(shares.resourceId, row.id)));
  const resource: Resource = {
    owner: ownerOf(row),
    visibility: row.visibility,
    shares: grants.map((s) => ({
      to: s.toUserId
        ? { type: "user", id: s.toUserId }
        : { type: "brewery", id: s.toBreweryId as string },
      level: s.level,
    })),
  };
  const err = denied(user, action, resource, what);
  if (err) throw err;
}

/**
 * SQL for "rows `viewer` can read", mirroring can() for lists. Unlisted rows only show to their
 * owner, brewery and shares. With `visibility: false`, server and public rows from other people
 * are left out too: only what is the viewer's own or was shared with them.
 */
export function readableBy(
  tx: Tx,
  viewer: User | null,
  type: ShareableType,
  table: {
    id: AnyPgColumn;
    ownerUserId: AnyPgColumn;
    ownerBreweryId: AnyPgColumn;
    visibility: AnyPgColumn;
  },
  opts: { visibility: boolean } = { visibility: true },
): SQL | undefined {
  if (!viewer) return opts.visibility ? eq(table.visibility, "public") : sql`false`;
  const breweryIds = viewer.memberships.map((m) => m.breweryId);
  const shared = exists(
    tx
      .select({ one: sql`1` })
      .from(shares)
      .where(
        and(
          eq(shares.resourceType, type),
          eq(shares.resourceId, table.id),
          or(
            eq(shares.toUserId, viewer.id),
            breweryIds.length ? inArray(shares.toBreweryId, breweryIds) : undefined,
          ),
        ),
      ),
  );
  return or(
    eq(table.ownerUserId, viewer.id),
    breweryIds.length ? inArray(table.ownerBreweryId, breweryIds) : undefined,
    shared,
    opts.visibility ? inArray(table.visibility, ["server", "public"]) : undefined,
  );
}
