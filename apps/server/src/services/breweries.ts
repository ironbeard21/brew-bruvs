// SPDX-License-Identifier: AGPL-3.0-or-later
// Breweries and their members. Owners manage the brewery, its members and invites; a brewery
// always keeps at least one owner. Only members can see a brewery.
import { type Db, schema } from "@brew-bruvs/db";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { hashSecret, newSecret } from "../auth/secrets.ts";
import type {
  AcceptInput,
  BreweryInput,
  BreweryPatch,
  InviteInput,
} from "../contracts/breweries.ts";
import { ApiError, pgCode } from "../errors.ts";
import type { BreweryRole, User } from "../permissions.ts";
import { moveToBrewery, newId, signedIn, type Tx } from "./access.ts";
import { recordActivity } from "./activity.ts";
import { moveBatchDevices } from "./device-readings.ts";
import { reserveForNewOwner } from "./inventory.ts";

const { breweries, memberships, breweryInvites, users } = schema;
const INVITE_DAYS = 7;

type BreweryRow = typeof breweries.$inferSelect;
type InviteRow = typeof breweryInvites.$inferSelect;

const notFound = () => new ApiError(404, "not_found", "Brewery not found");
const ownersOnly = () => new ApiError(403, "forbidden", "Only the brewery's owners can do that");

function view(row: BreweryRow, role: BreweryRole) {
  return {
    id: row.id,
    uri: row.uri,
    name: row.name,
    description: row.description,
    city: row.city,
    state: row.state,
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createBreweryService(db: Db, opts: { baseUrl: string }) {
  /** The brewery and the user's role in it, read under a lock on its memberships when asked. */
  async function membership(tx: Tx, user: User, id: string, lock = false) {
    const query = tx
      .select({ brewery: breweries, role: memberships.role })
      .from(breweries)
      .innerJoin(memberships, eq(memberships.breweryId, breweries.id))
      .where(and(eq(breweries.id, id), eq(memberships.userId, user.id)));
    const [row] = await (lock ? query.for("update") : query);
    if (!row) throw notFound();
    return row;
  }

  async function asOwner(tx: Tx, viewer: User | null, id: string) {
    const row = await membership(tx, signedIn(viewer), id, true);
    if (row.role !== "owner") throw ownersOnly();
    return row;
  }

  async function members(tx: Tx, id: string) {
    const rows = await tx
      .select({
        userId: memberships.userId,
        displayName: users.displayName,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.breweryId, id))
      .orderBy(asc(memberships.createdAt), asc(users.displayName));
    return rows.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }));
  }

  async function detail(tx: Tx, row: BreweryRow, role: BreweryRole) {
    return { ...view(row, role), members: await members(tx, row.id) };
  }

  /** Locks the brewery's memberships and returns the target's role; 404 if not a member. */
  async function memberRole(tx: Tx, id: string, userId: string) {
    const rows = await tx
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.breweryId, id))
      .for("update");
    const target = rows.find((m) => m.userId === userId);
    if (!target) throw new ApiError(404, "not_found", "Member not found");
    const owners = rows.filter((m) => m.role === "owner").length;
    return { role: target.role, lastOwner: target.role === "owner" && owners === 1 };
  }

  const lastOwner = () =>
    new ApiError(409, "last_owner", "A brewery needs an owner: make someone else an owner first");

  function viewInvite(row: InviteRow, brewery: { id: string; name: string }, code?: string) {
    return {
      id: row.id,
      brewery,
      role: row.role,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ...(code ? { code } : {}),
    };
  }

  const pending = () =>
    and(isNull(breweryInvites.usedAt), gt(breweryInvites.expiresAt, new Date()));

  async function inviteList(tx: Tx, where: ReturnType<typeof and>) {
    const rows = await tx
      .select({ invite: breweryInvites, breweryName: breweries.name })
      .from(breweryInvites)
      .innerJoin(breweries, eq(breweries.id, breweryInvites.breweryId))
      .where(and(pending(), where))
      .orderBy(asc(breweryInvites.createdAt));
    return {
      items: rows.map((r) => viewInvite(r.invite, { id: r.invite.breweryId, name: r.breweryName })),
    };
  }

  return {
    move: (
      viewer: User | null,
      type: Parameters<typeof moveToBrewery>[2],
      id: string,
      breweryId: string,
    ) =>
      db.transaction(async (tx) => {
        const owner = await moveToBrewery(tx, viewer, type, id, breweryId);
        if (type === "batch") {
          await moveBatchDevices(tx, id, breweryId);
          await reserveForNewOwner(tx, id);
        }
        return owner;
      }),

    /** The breweries the user belongs to, by name. */
    async list(viewer: User | null) {
      const user = signedIn(viewer);
      const rows = await db
        .select({ brewery: breweries, role: memberships.role })
        .from(breweries)
        .innerJoin(memberships, eq(memberships.breweryId, breweries.id))
        .where(eq(memberships.userId, user.id))
        .orderBy(asc(breweries.name), asc(breweries.id));
      return { items: rows.map((r) => view(r.brewery, r.role)) };
    },

    /** The creator is the brewery's first owner. */
    async create(viewer: User | null, input: z.infer<typeof BreweryInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const id = await newId(tx);
        const [row] = await tx
          .insert(breweries)
          .values({ ...input, id, uri: `${opts.baseUrl}/breweries/${id}` })
          .returning();
        await tx.insert(memberships).values({ breweryId: id, userId: user.id, role: "owner" });
        return detail(tx, row as BreweryRow, "owner");
      });
    },

    async get(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        const row = await membership(tx, signedIn(viewer), id);
        return detail(tx, row.brewery, row.role);
      });
    },

    async update(viewer: User | null, id: string, patch: z.infer<typeof BreweryPatch>) {
      return db.transaction(async (tx) => {
        const { role } = await asOwner(tx, viewer, id);
        const [row] = await tx.update(breweries).set(patch).where(eq(breweries.id, id)).returning();
        return detail(tx, row as BreweryRow, role);
      });
    },

    /** Only an empty brewery can be deleted: move or delete what it owns first. */
    async remove(viewer: User | null, id: string) {
      try {
        await db.transaction(async (tx) => {
          await asOwner(tx, viewer, id);
          await tx.delete(breweries).where(eq(breweries.id, id));
        });
      } catch (err) {
        if (pgCode(err) === "23001" || pgCode(err) === "23503") {
          throw new ApiError(
            409,
            "brewery_not_empty",
            "The brewery still owns recipes, batches or other things",
          );
        }
        throw err;
      }
    },

    async setRole(viewer: User | null, id: string, userId: string, role: BreweryRole) {
      return db.transaction(async (tx) => {
        const me = await asOwner(tx, viewer, id);
        const target = await memberRole(tx, id, userId);
        if (target.lastOwner && role !== "owner") throw lastOwner();
        await tx
          .update(memberships)
          .set({ role })
          .where(and(eq(memberships.breweryId, id), eq(memberships.userId, userId)));
        const myRole = userId === (viewer as User).id ? role : me.role;
        return detail(tx, me.brewery, myRole);
      });
    },

    /** Owners remove anyone; anyone can leave. The last owner can't go. */
    async removeMember(viewer: User | null, id: string, userId: string) {
      const user = signedIn(viewer);
      await db.transaction(async (tx) => {
        const me = await membership(tx, user, id, true);
        if (userId !== user.id && me.role !== "owner") throw ownersOnly();
        const target = await memberRole(tx, id, userId);
        if (target.lastOwner) throw lastOwner();
        await tx
          .delete(memberships)
          .where(and(eq(memberships.breweryId, id), eq(memberships.userId, userId)));
      });
    },

    /** Makes another member an owner and the caller a brewer. */
    async transfer(viewer: User | null, id: string, userId: string) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const me = await asOwner(tx, viewer, id);
        if (userId === user.id) {
          throw new ApiError(400, "validation_error", "Transfer to another member");
        }
        await memberRole(tx, id, userId);
        const set = (who: string, role: BreweryRole) =>
          tx
            .update(memberships)
            .set({ role })
            .where(and(eq(memberships.breweryId, id), eq(memberships.userId, who)));
        await set(userId, "owner");
        await set(user.id, "brewer");
        return detail(tx, me.brewery, "brewer");
      });
    },

    /**
     * Invites an email address, or makes a one-time code. Invites last 7 days; a new invite to the
     * same email replaces its pending one.
     */
    async invite(viewer: User | null, id: string, input: z.infer<typeof InviteInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const { brewery } = await asOwner(tx, viewer, id);
        const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
        const target = { id: brewery.id, name: brewery.name };
        if (input.email === undefined) {
          const code = newSecret();
          const [row] = await tx
            .insert(breweryInvites)
            .values({
              breweryId: id,
              role: input.role,
              codeHash: hashSecret(code),
              createdByUserId: user.id,
              expiresAt,
            })
            .returning();
          return viewInvite(row as InviteRow, target, code);
        }
        // Bound to whoever has the email now. A later signup can't claim it (emails aren't
        // verified). The reply is the same either way, so it doesn't reveal who has an account.
        const email = input.email.toLowerCase();
        const [invitee] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`);
        await tx
          .delete(breweryInvites)
          .where(
            and(
              eq(breweryInvites.breweryId, id),
              eq(breweryInvites.email, email),
              isNull(breweryInvites.usedAt),
            ),
          );
        const [row] = await tx
          .insert(breweryInvites)
          .values({
            breweryId: id,
            role: input.role,
            email,
            toUserId: invitee?.id ?? null,
            createdByUserId: user.id,
            expiresAt,
          })
          .returning();
        return viewInvite(row as InviteRow, target);
      });
    },

    /** The brewery's pending invites, for its owners. */
    async invites(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        await asOwner(tx, viewer, id);
        return inviteList(tx, eq(breweryInvites.breweryId, id));
      });
    },

    async revokeInvite(viewer: User | null, id: string, inviteId: string) {
      await db.transaction(async (tx) => {
        await asOwner(tx, viewer, id);
        const gone = await tx
          .delete(breweryInvites)
          .where(and(eq(breweryInvites.id, inviteId), eq(breweryInvites.breweryId, id)))
          .returning({ id: breweryInvites.id });
        if (!gone.length) throw new ApiError(404, "not_found", "Invite not found");
      });
    },

    /** Pending invites sent to the user. */
    async myInvites(viewer: User | null) {
      const user = signedIn(viewer);
      return inviteList(db, eq(breweryInvites.toUserId, user.id));
    },

    async decline(viewer: User | null, inviteId: string) {
      const user = signedIn(viewer);
      const gone = await db
        .delete(breweryInvites)
        .where(
          and(
            eq(breweryInvites.id, inviteId),
            eq(breweryInvites.toUserId, user.id),
            isNull(breweryInvites.usedAt),
          ),
        )
        .returning({ id: breweryInvites.id });
      if (!gone.length) throw new ApiError(404, "not_found", "Invite not found");
    },

    /** Joins with a one-time code or an invite sent to you. Each invite works once. */
    async accept(viewer: User | null, input: z.infer<typeof AcceptInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const [invite] = await tx
          .select()
          .from(breweryInvites)
          .where(
            and(
              pending(),
              "code" in input
                ? eq(breweryInvites.codeHash, hashSecret(input.code))
                : and(eq(breweryInvites.id, input.id), eq(breweryInvites.toUserId, user.id)),
            ),
          )
          .for("update");
        if (!invite) {
          throw new ApiError(404, "invalid_invite", "That invite is not valid or has expired");
        }
        const [already] = await tx
          .select({ one: sql`1` })
          .from(memberships)
          .where(and(eq(memberships.breweryId, invite.breweryId), eq(memberships.userId, user.id)));
        if (already) throw new ApiError(409, "already_member", "You are already a member");
        await tx
          .update(breweryInvites)
          .set({ usedAt: new Date() })
          .where(eq(breweryInvites.id, invite.id));
        await tx
          .insert(memberships)
          .values({ breweryId: invite.breweryId, userId: user.id, role: invite.role });
        await recordActivity(tx, {
          breweryId: invite.breweryId,
          actorUserId: user.id,
          verb: "member_joined",
          objectType: "user",
          objectId: user.id,
        });
        const [brewery] = await tx
          .select()
          .from(breweries)
          .where(eq(breweries.id, invite.breweryId));
        return detail(tx, brewery as BreweryRow, invite.role);
      });
    },
  };
}

export type BreweryService = ReturnType<typeof createBreweryService>;
