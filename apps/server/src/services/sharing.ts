// SPDX-License-Identifier: AGPL-3.0-or-later
// Visibility and shares for batches, notes, inventory, equipment and equipment profiles: the same
// rules recipes have (recipes keep their own, which add the import-credit checks).
import { type Db, schema } from "@brew-bruvs/db";
import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { ShareInput, Visibility } from "../contracts/recipes.ts";
import { ApiError } from "../errors.ts";
import type { User } from "../permissions.ts";
import { ownedRow, type ShareableType, signedIn } from "./access.ts";

const { shares, users, breweries } = schema;

export type SharedType = Exclude<ShareableType, "recipe">;

function viewShare(
  share: typeof shares.$inferSelect,
  user: { id: string; displayName: string } | null,
) {
  return {
    id: share.id,
    user,
    breweryId: share.toBreweryId,
    level: share.level,
    createdAt: share.createdAt.toISOString(),
  };
}

export function createSharingService(db: Db) {
  return {
    /** Only those who can share it (owners, brewery owners) change who can see it. */
    async setVisibility(
      viewer: User | null,
      type: SharedType,
      id: string,
      visibility: z.infer<typeof Visibility>,
    ) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const { table } = await ownedRow(tx, user, "share", type, id);
        await tx.execute(
          sql`UPDATE ${sql.identifier(table)} SET visibility = ${visibility}, updated_at = now() WHERE id = ${id}`,
        );
        return { id, visibility };
      });
    },

    async list(viewer: User | null, type: SharedType, id: string) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        await ownedRow(tx, user, "share", type, id);
        const rows = await tx
          .select({ share: shares, userId: users.id, displayName: users.displayName })
          .from(shares)
          .leftJoin(users, eq(users.id, shares.toUserId))
          .where(and(eq(shares.resourceType, type), eq(shares.resourceId, id)))
          .orderBy(asc(shares.createdAt));
        return rows.map((r) =>
          viewShare(
            r.share,
            r.userId ? { id: r.userId, displayName: r.displayName as string } : null,
          ),
        );
      });
    },

    /** Shares with a user (by email) or a brewery; sharing again changes the level. */
    async share(
      viewer: User | null,
      type: SharedType,
      id: string,
      input: z.infer<typeof ShareInput>,
    ) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const { row, what } = await ownedRow(tx, user, "share", type, id);
        let to: { toUserId: string } | { toBreweryId: string };
        let invitee: { id: string; displayName: string } | null = null;
        if (input.email !== undefined) {
          [invitee = null] = await tx
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(sql`lower(${users.email}) = lower(${input.email})`);
          if (!invitee)
            throw new ApiError(404, "user_not_found", "No account with that email here");
          if (invitee.id === row.ownerUserId) {
            throw new ApiError(
              400,
              "cannot_share_with_owner",
              `That's the ${what.toLowerCase()}'s owner`,
            );
          }
          to = { toUserId: invitee.id };
        } else {
          const breweryId = input.breweryId as string;
          const [brewery] = await tx
            .select({ id: breweries.id })
            .from(breweries)
            .where(eq(breweries.id, breweryId));
          if (!brewery) throw new ApiError(404, "brewery_not_found", "No brewery with that id");
          to = { toBreweryId: breweryId };
        }
        const [share] = await tx
          .insert(shares)
          .values({ resourceType: type, resourceId: id, level: input.level, ...to })
          .onConflictDoUpdate({
            target: [shares.resourceType, shares.resourceId, shares.toUserId, shares.toBreweryId],
            set: { level: input.level },
          })
          .returning();
        return viewShare(share as typeof shares.$inferSelect, invitee);
      });
    },

    async unshare(viewer: User | null, type: SharedType, id: string, shareId: string) {
      const user = signedIn(viewer);
      await db.transaction(async (tx) => {
        await ownedRow(tx, user, "share", type, id);
        const removed = await tx
          .delete(shares)
          .where(
            and(eq(shares.id, shareId), eq(shares.resourceType, type), eq(shares.resourceId, id)),
          )
          .returning({ id: shares.id });
        if (!removed.length) throw new ApiError(404, "not_found", "Share not found");
      });
    },
  };
}

export type SharingService = ReturnType<typeof createSharingService>;
