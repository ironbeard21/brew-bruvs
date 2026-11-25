// SPDX-License-Identifier: AGPL-3.0-or-later
// A brewer's own equipment profiles: volumes, losses and efficiency used to scale recipes.
import { type Db, schema } from "@brew-bruvs/db";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import type { CreateEquipmentProfile, EquipmentProfilePatch } from "../contracts/recipes.ts";
import { ApiError, pgCode } from "../errors.ts";
import type { Action, User } from "../permissions.ts";
import { authorizeRow, newId, newOwner, ownerOf, signedIn, type Tx } from "./access.ts";

const { equipmentProfiles, shares } = schema;
type ProfileRow = typeof equipmentProfiles.$inferSelect;

function view(row: ProfileRow) {
  return {
    id: row.id,
    uri: row.uri,
    name: row.name,
    owner: ownerOf(row) as NonNullable<ReturnType<typeof ownerOf>>,
    catalogId: row.catalogId,
    batchSizeL: row.batchSizeL,
    boilSizeL: row.boilSizeL,
    kettleVolumeL: row.kettleVolumeL,
    kettleLossL: row.kettleLossL,
    boilRateLPerHr: row.boilRateLPerHr,
    mashTunVolumeL: row.mashTunVolumeL,
    grainAbsorptionLPerKg: row.grainAbsorptionLPerKg,
    efficiencyPct: row.efficiencyPct,
    fermenterLossL: row.fermenterLossL,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function catalogChecked<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (pgCode(err) === "23503") {
      throw new ApiError(400, "unknown_catalog_id", "No catalog equipment with that id");
    }
    throw err;
  }
}

export function createEquipmentProfileService(db: Db, opts: { baseUrl: string }) {
  async function authorize(tx: Tx, user: User | null, action: Action, id: string) {
    const [row] = await tx.select().from(equipmentProfiles).where(eq(equipmentProfiles.id, id));
    if (!row) throw new ApiError(404, "not_found", "Equipment profile not found");
    await authorizeRow(tx, user, action, "equipment_profile", row, "Equipment profile");
    return row;
  }

  return {
    /** The profile if `user` can read it, else null. */
    async readable(tx: Tx, user: User, id: string): Promise<ProfileRow | null> {
      try {
        return await authorize(tx, user, "read", id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },

    async list(viewer: User | null) {
      const user = signedIn(viewer);
      const rows = await db
        .select()
        .from(equipmentProfiles)
        .where(eq(equipmentProfiles.ownerUserId, user.id))
        .orderBy(equipmentProfiles.name, equipmentProfiles.id);
      return rows.map(view);
    },

    async create(viewer: User | null, input: z.infer<typeof CreateEquipmentProfile>) {
      const user = signedIn(viewer);
      const { breweryId, ...fields } = input;
      const owner = newOwner(user, breweryId);
      return catalogChecked(() =>
        db.transaction(async (tx) => {
          const id = await newId(tx);
          const [row] = await tx
            .insert(equipmentProfiles)
            .values({
              ...fields,
              id,
              uri: `${opts.baseUrl}/equipment-profiles/${id}`,
              ...owner,
            })
            .returning();
          return view(row as ProfileRow);
        }),
      );
    },

    async get(viewer: User | null, id: string) {
      return view(await authorize(db, viewer, "read", id));
    },

    async update(viewer: User | null, id: string, patch: z.infer<typeof EquipmentProfilePatch>) {
      return catalogChecked(() =>
        db.transaction(async (tx) => {
          const current = await authorize(tx, viewer, "edit", id);
          if (Object.keys(patch).length === 0) return view(current);
          const [row] = await tx
            .update(equipmentProfiles)
            .set(patch)
            .where(eq(equipmentProfiles.id, id))
            .returning();
          return view(row as ProfileRow);
        }),
      );
    },

    /** Recipe versions and batches that used it keep their numbers; their link goes null. */
    async remove(viewer: User | null, id: string) {
      await db.transaction(async (tx) => {
        await authorize(tx, viewer, "delete", id);
        // Lock the row first: sharing holds it while adding a share, so one can't slip in
        // between removing the shares and removing the row.
        await tx
          .select({ id: equipmentProfiles.id })
          .from(equipmentProfiles)
          .where(eq(equipmentProfiles.id, id))
          .for("update");
        await tx
          .delete(shares)
          .where(and(eq(shares.resourceType, "equipment_profile"), eq(shares.resourceId, id)));
        await tx.delete(equipmentProfiles).where(eq(equipmentProfiles.id, id));
      });
    },
  };
}

export type EquipmentProfileService = ReturnType<typeof createEquipmentProfileService>;
