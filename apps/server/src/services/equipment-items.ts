// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Db, schema } from "@brew-bruvs/db";
import { and, eq } from "drizzle-orm";
import type { EquipmentItemInput, EquipmentItemPatch } from "../contracts/equipment-items.ts";
import { ApiError } from "../errors.ts";
import type { Action, User } from "../permissions.ts";
import { authorizeRow, denied, newId, ownerOf, readableBy, signedIn, type Tx } from "./access.ts";

const { activityEvents, equipment, equipmentItems, memberships } = schema;
const shareableType = "equipment_item";
const label = "Equipment item";
type Item = typeof equipmentItems.$inferSelect;

function view(row: Item) {
  const { ownerUserId, ownerBreweryId, createdAt, updatedAt, ...item } = row;
  const owner = ownerOf({ ownerUserId, ownerBreweryId });
  if (!owner) throw new Error("Equipment item has no owner");
  return { ...item, owner, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

async function catalogDefaults(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      name: equipment.name,
      type: equipment.category,
      batchSizeL: equipment.batchSizeL,
      boilSizeL: equipment.boilSizeL,
      kettleVolumeL: equipment.kettleVolumeL,
      kettleLossL: equipment.kettleLossL,
      boilRateLPerHr: equipment.boilRateLPerHr,
      mashTunVolumeL: equipment.mashTunVolumeL,
      grainAbsorptionLPerKg: equipment.grainAbsorptionLPerKg,
    })
    .from(equipment)
    .where(eq(equipment.id, id))
    .for("key share");
  if (!row) throw new ApiError(400, "unknown_catalog_id", "No catalog equipment with that id");
  return row;
}

async function lockedItem(tx: Tx, user: User, action: Action, id: string) {
  const [row] = await tx
    .select()
    .from(equipmentItems)
    .where(eq(equipmentItems.id, id))
    .for("update");
  if (!row) throw new ApiError(404, "not_found", "Equipment item not found");
  await authorizeRow(tx, user, action, shareableType, row, label);
  return row;
}

function checkBrewery(user: User, action: Action, breweryId: string) {
  const err = denied(
    user,
    action,
    { owner: { type: "brewery", id: breweryId }, visibility: "private", shares: [] },
    "Brewery",
  );
  if (err) throw err;
}

export function createEquipmentItemService(db: Db, { baseUrl }: { baseUrl: string }) {
  return {
    async list(
      viewer: User | null,
      {
        breweryId,
        limit,
        offset,
      }: {
        breweryId?: string | undefined;
        limit: number;
        offset: number;
      },
    ) {
      const user = signedIn(viewer);
      if (breweryId) checkBrewery(user, "read", breweryId);
      const rows = await db
        .select()
        .from(equipmentItems)
        .where(
          and(
            readableBy(db, user, shareableType, equipmentItems, { visibility: false }),
            breweryId ? eq(equipmentItems.ownerBreweryId, breweryId) : undefined,
          ),
        )
        .orderBy(equipmentItems.name, equipmentItems.id)
        .limit(limit + 1)
        .offset(offset);
      return {
        items: rows.slice(0, limit).map(view),
        nextOffset: rows.length > limit ? offset + limit : null,
      };
    },

    async create(viewer: User | null, input: EquipmentItemInput) {
      const user = signedIn(viewer);
      const { breweryId, catalogId, name, ...properties } = input;
      if (breweryId) checkBrewery(user, "edit", breweryId);
      return db.transaction(async (tx) => {
        const defaults = catalogId ? await catalogDefaults(tx, catalogId) : undefined;
        const itemName = name ?? defaults?.name;
        if (!itemName)
          throw new ApiError(400, "validation_error", "Give the equipment item a name");
        const id = await newId(tx);
        const [row] = await tx
          .insert(equipmentItems)
          .values({
            ...defaults,
            ...properties,
            name: itemName,
            catalogId,
            id,
            uri: `${baseUrl}/equipment/${id}`,
            ownerUserId: breweryId ? null : user.id,
            ownerBreweryId: breweryId,
          })
          .returning();
        return view(row as Item);
      });
    },

    async update(viewer: User | null, id: string, patch: EquipmentItemPatch) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const item = await lockedItem(tx, user, "edit", id);
        if (Object.keys(patch).length === 0) return view(item);
        const [row] = await tx
          .update(equipmentItems)
          .set(patch)
          .where(eq(equipmentItems.id, id))
          .returning();
        return view(row as Item);
      });
    },

    async remove(viewer: User | null, id: string) {
      const user = signedIn(viewer);
      await db.transaction(async (tx) => {
        await lockedItem(tx, user, "delete", id);
        await tx.delete(equipmentItems).where(eq(equipmentItems.id, id));
      });
    },

    async setHolder(viewer: User | null, id: string, heldByUserId: string | null) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const item = await lockedItem(tx, user, "edit", id);
        const breweryId = item.ownerBreweryId;
        if (!breweryId)
          throw new ApiError(
            400,
            "brewery_equipment_required",
            "Only brewery equipment can be lent",
          );
        checkBrewery(user, "edit", breweryId);

        if (heldByUserId) {
          const [member] = await tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(and(eq(memberships.breweryId, breweryId), eq(memberships.userId, heldByUserId)))
            .for("key share");
          if (!member)
            throw new ApiError(
              400,
              "unknown_brewery_member",
              "The holder must belong to this brewery",
            );
        }

        if (item.heldByUserId === heldByUserId) return view(item);
        const [row] = await tx
          .update(equipmentItems)
          .set({ heldByUserId })
          .where(eq(equipmentItems.id, id))
          .returning();
        await tx.insert(activityEvents).values({
          breweryId,
          actorUserId: user.id,
          verb: heldByUserId ? "item_lent" : "item_returned",
          objectType: shareableType,
          objectId: id,
        });
        return view(row as Item);
      });
    },
  };
}

export type EquipmentItemService = ReturnType<typeof createEquipmentItemService>;
