// SPDX-License-Identifier: AGPL-3.0-or-later
// Inventory items, and what batches do to them: starting a batch reserves its ingredients from
// the batch owner's inventory, packaging or bottling uses them up, and undoing either move gives
// them back. Quantities are in each item's unit (kg, L, each).
import { type Db, schema } from "@brew-bruvs/db";
import { and, asc, eq, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { CreateInventoryItem, InventoryItemPatch } from "../contracts/inventory.ts";
import { RecipeContent } from "../contracts/recipe-content.ts";
import { ApiError } from "../errors.ts";
import type { User } from "../permissions.ts";
import { authorizeRow, newId, newOwner, ownerOf, signedIn, type Tx } from "./access.ts";
import {
  catalogValues,
  computeStats,
  efficiencyOf,
  equipmentOf,
  scaleContent,
} from "./recipe-stats.ts";

const { inventoryItems, inventoryReservations, batches, recipeVersions, shares } = schema;

type ItemRow = typeof inventoryItems.$inferSelect;
type BatchRow = typeof batches.$inferSelect;
type Unit = ItemRow["quantityUnit"];
type Status = BatchRow["status"];
type Owner = { ownerUserId: string | null; ownerBreweryId: string | null };

// What started batches hold. Qualified by hand: Drizzle leaves single-table columns unqualified.
const reservedSum = sql<number>`coalesce((SELECT sum(r.quantity) FROM inventory_reservations r WHERE r.inventory_item_id = "inventory_items"."id" AND r.state = 'reserved'), 0)`;

const EPSILON = 1e-9;

function view(row: ItemRow & { reserved: number }) {
  const owner = ownerOf(row);
  const reserved = Number(row.reserved);
  return {
    id: row.id,
    uri: row.uri,
    owner: owner as NonNullable<typeof owner>,
    name: row.name,
    catalogId: row.catalogId,
    quantity: row.quantity,
    quantityUnit: row.quantityUnit,
    reserved,
    available: row.quantity - reserved,
    lot: row.lot,
    location: row.location,
    alphaAcidPct: row.alphaAcidPct,
    purchasedOn: row.purchasedOn,
    bestBefore: row.bestBefore,
    lowStockThreshold: row.lowStockThreshold,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── What a batch needs ────────────────────────────────────────────────

type Line = { name: string; catalogId: string | null; unit: Unit; amount: number };

/** Every ingredient line with an amount, in inventory units. */
export function linesOf(content: RecipeContent): Line[] {
  const out: Line[] = [];
  const add = (
    l: { name: string; catalogId?: string | undefined },
    amounts: [Unit, number | undefined][],
  ) => {
    const [unit, amount] = amounts.find(([, a]) => a !== undefined && a > 0) ?? [];
    if (unit && amount) out.push({ name: l.name, catalogId: l.catalogId ?? null, unit, amount });
  };
  for (const f of content.fermentables)
    add(f, [
      ["kg", f.amountKg],
      ["l", f.amountL],
    ]);
  for (const h of content.hops) add(h, [["kg", h.amountKg]]);
  for (const y of content.yeasts) {
    add(y, [
      ["each", y.packs],
      ["kg", y.amountKg],
      ["l", y.amountL],
    ]);
  }
  for (const m of content.miscs) {
    add(m, [
      ["kg", m.amountKg],
      ["l", m.amountL],
      ["each", m.count],
    ]);
  }
  return out;
}

/** The recipe version scaled to the batch's size and equipment. */
async function batchContent(tx: Tx, batch: BatchRow) {
  const [version] = await tx
    .select()
    .from(recipeVersions)
    .where(eq(recipeVersions.id, batch.recipeVersionId));
  if (!version) throw new ApiError(404, "not_found", "Recipe version not found");
  const content = RecipeContent.parse(version.content);
  const fromEquipment = await equipmentOf(tx, version.equipmentProfileId);
  const toEquipment = await equipmentOf(tx, batch.equipmentProfileId);
  const batchSizeL = batch.batchSizeL ?? version.batchSizeL;
  return {
    batchSizeL,
    equipment: toEquipment,
    content: scaleContent(
      content,
      { batchSizeL: version.batchSizeL, efficiencyPct: efficiencyOf(content, fromEquipment) },
      { batchSizeL, efficiencyPct: efficiencyOf(content, toEquipment) },
    ),
  };
}

type Stock = ItemRow & { available: number };

/** The owner's items, soonest best-before first, with what's still free. */
async function stockOf(tx: Tx, owner: Owner, lock: boolean): Promise<Stock[]> {
  // Lock first, then read what's reserved in a new statement: a statement that waited for the
  // locks still sees its old snapshot, without reservations another start just committed.
  if (lock) {
    await tx
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(ownerIs(owner))
      .for("update");
  }
  const query = tx
    .select({ item: inventoryItems, reserved: reservedSum })
    .from(inventoryItems)
    .where(ownerIs(owner))
    .orderBy(
      sql`${inventoryItems.bestBefore} ASC NULLS LAST`,
      asc(inventoryItems.createdAt),
      asc(inventoryItems.id),
    );
  const rows = await query;
  return rows.map((r) => ({ ...r.item, available: r.item.quantity - Number(r.reserved) }));
}

function ownerIs(owner: Owner): SQL {
  return owner.ownerBreweryId
    ? eq(inventoryItems.ownerBreweryId, owner.ownerBreweryId)
    : eq(inventoryItems.ownerUserId, owner.ownerUserId as string);
}

/** Matching items for a line: by catalog id first, then by name; same unit only. */
function matches(line: { name: string; catalogId: string | null; unit?: Unit }, stock: Stock[]) {
  const sameUnit = stock.filter((i) => !line.unit || i.quantityUnit === line.unit);
  const byCatalog = line.catalogId ? sameUnit.filter((i) => i.catalogId === line.catalogId) : [];
  if (byCatalog.length) return byCatalog;
  const name = line.name.trim().toLowerCase();
  return sameUnit.filter((i) => i.name.trim().toLowerCase() === name);
}

/** Takes what each line needs from free stock, lowering `available` as it goes. */
function allocate(lines: Line[], stock: Stock[]) {
  const takes: { item: Stock; quantity: number }[] = [];
  const short: (Omit<Line, "amount"> & { short: number })[] = [];
  for (const line of lines) {
    let need = line.amount;
    for (const item of matches(line, stock)) {
      const take = Math.min(need, Math.max(0, item.available));
      if (take <= EPSILON) continue;
      takes.push({ item, quantity: take });
      item.available -= take;
      need -= take;
      if (need <= EPSILON) break;
    }
    if (need > EPSILON) {
      short.push({ name: line.name, catalogId: line.catalogId, unit: line.unit, short: need });
    }
  }
  return { takes, short };
}

// ── Reservations through a batch's life ───────────────────────────────

const USED_STATUSES: readonly Status[] = ["packaged", "bottled", "bottle_aging", "finished"];
/** 0 planned · 1 started (reserved) · 2 packaged or bottled (used). */
const stage = (s: Status) => (s === "planned" ? 0 : USED_STATUSES.includes(s) ? 2 : 1);

const viewReservation = (
  r: { inventoryItemId: string; quantity: number; state: "reserved" | "used" | "released" },
  item: { name: string; quantityUnit: Unit },
) => ({
  itemId: r.inventoryItemId,
  name: item.name,
  quantity: r.quantity,
  unit: item.quantityUnit,
  state: r.state,
});

const ofBatch = (batchId: string, state: "reserved" | "used") =>
  and(eq(inventoryReservations.batchId, batchId), eq(inventoryReservations.state, state));

async function release(tx: Tx, batchId: string) {
  return tx
    .update(inventoryReservations)
    .set({ state: "released" })
    .where(ofBatch(batchId, "reserved"))
    .returning({ id: inventoryReservations.id });
}

/**
 * Takes reserved stock off the shelf. Each reservation keeps the amount actually taken, which
 * can be less than reserved if the item was corrected down since; undo puts back exactly that.
 */
async function useUp(tx: Tx, batchId: string) {
  const held = await tx
    .select({ r: inventoryReservations, onHand: inventoryItems.quantity })
    .from(inventoryReservations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryReservations.inventoryItemId))
    .where(ofBatch(batchId, "reserved"))
    .orderBy(asc(inventoryReservations.id))
    .for("update");
  const left = new Map(held.map((h) => [h.r.inventoryItemId, h.onHand]));
  for (const { r } of held) {
    const take = Math.min(r.quantity, left.get(r.inventoryItemId) ?? 0);
    left.set(r.inventoryItemId, (left.get(r.inventoryItemId) ?? 0) - take);
    if (take <= EPSILON) {
      await tx
        .update(inventoryReservations)
        .set({ state: "released" })
        .where(eq(inventoryReservations.id, r.id));
      continue;
    }
    await tx
      .update(inventoryItems)
      .set({ quantity: sql`${inventoryItems.quantity} - ${take}` })
      .where(eq(inventoryItems.id, r.inventoryItemId));
    await tx
      .update(inventoryReservations)
      .set({ state: "used", quantity: take })
      .where(eq(inventoryReservations.id, r.id));
  }
}

/** Puts used stock back on the shelf and holds it for the batch again. */
async function putBack(tx: Tx, batchId: string) {
  const rows = await tx
    .update(inventoryReservations)
    .set({ state: "reserved" })
    .where(ofBatch(batchId, "used"))
    .returning();
  for (const r of rows) {
    await tx
      .update(inventoryItems)
      .set({ quantity: sql`${inventoryItems.quantity} + ${r.quantity}` })
      .where(eq(inventoryItems.id, r.inventoryItemId));
  }
}

/** Reserves what the batch needs from its owner's inventory and reports what's short. */
async function reserve(tx: Tx, batch: BatchRow) {
  const { content } = await batchContent(tx, batch);
  const { takes, short } = allocate(linesOf(content), await stockOf(tx, batch, true));
  const reserved: ReturnType<typeof viewReservation>[] = [];
  for (const { item, quantity } of takes) {
    const [row] = await tx
      .insert(inventoryReservations)
      .values({ batchId: batch.id, inventoryItemId: item.id, quantity })
      .returning();
    if (row) reserved.push(viewReservation(row, item));
  }
  return { reserved, short };
}

/** Whether any of the batch's holds are on stock its current owner doesn't own. */
async function holdsOthersStock(tx: Tx, batch: BatchRow) {
  const [row] = await tx
    .select({ id: inventoryReservations.id })
    .from(inventoryReservations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryReservations.inventoryItemId))
    .where(and(ofBatch(batch.id, "reserved"), sql`(${ownerIs(batch)}) IS NOT TRUE`))
    .limit(1);
  return row !== undefined;
}

/**
 * After a started batch changes owner, what it holds comes from the new owner's inventory: any
 * old holds are released and it reserves again, even if it held nothing before. A planned batch
 * holds nothing yet, and a packaged one has already used its stock.
 */
export async function reserveForNewOwner(tx: Tx, batchId: string) {
  const [batch] = await tx.select().from(batches).where(eq(batches.id, batchId));
  if (!batch || stage(batch.status) !== 1) return;
  await release(tx, batchId);
  await reserve(tx, batch);
}

/**
 * Keeps a batch's reservations in step with a status move. Returns null when the move doesn't
 * change them (e.g. brewing → fermenting).
 */
export async function syncReservations(tx: Tx, batch: BatchRow, from: Status, to: Status) {
  const a = stage(from);
  const b = stage(to);
  if (a === b) return null;
  const change = {
    reserved: [] as ReturnType<typeof viewReservation>[],
    short: [] as ReturnType<typeof allocate>["short"],
    used: false,
    released: false,
  };
  if (a === 0) Object.assign(change, await reserve(tx, batch));
  if (a < 2 && b === 2) {
    await useUp(tx, batch.id);
    change.used = true;
  }
  if (a === 2 && b < 2) {
    // The used stock goes back where it came from. If the batch has changed owner since, that
    // was the old owner's: give it back to them and reserve from the current owner instead.
    await putBack(tx, batch.id);
    if (await holdsOthersStock(tx, batch)) {
      await release(tx, batch.id);
      Object.assign(change, await reserve(tx, batch));
    }
  }
  if (b === 0) {
    await release(tx, batch.id);
    change.released = true;
  }
  return change;
}

/** The reservations of a batch the caller has already been allowed to read. */
export async function reservationsOf(tx: Tx, batchId: string) {
  const rows = await tx
    .select({
      r: inventoryReservations,
      name: inventoryItems.name,
      unit: inventoryItems.quantityUnit,
    })
    .from(inventoryReservations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryReservations.inventoryItemId))
    .where(eq(inventoryReservations.batchId, batchId))
    .orderBy(asc(inventoryReservations.createdAt), asc(inventoryReservations.id));
  return { items: rows.map((x) => viewReservation(x.r, { name: x.name, quantityUnit: x.unit })) };
}

/** A batch's stats, with hop alpha acid from the inventory lots reserved for it. */
export async function batchStats(tx: Tx, batch: BatchRow) {
  const { content, batchSizeL, equipment } = await batchContent(tx, batch);
  const lots = await tx
    .select({ item: inventoryItems })
    .from(inventoryReservations)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryReservations.inventoryItemId))
    .where(
      and(
        eq(inventoryReservations.batchId, batch.id),
        inArray(inventoryReservations.state, ["reserved", "used"]),
        sql`${inventoryItems.alphaAcidPct} IS NOT NULL`,
      ),
    );
  const stock = lots.map((l) => ({ ...l.item, available: 0 }));
  const fromInventory: { hop: string; alphaAcidPct: number; itemId: string }[] = [];
  const hops = content.hops.map((h) => {
    const [lot] = matches({ name: h.name, catalogId: h.catalogId ?? null, unit: "kg" }, stock);
    if (!lot || lot.alphaAcidPct === null) return h;
    fromInventory.push({ hop: h.name, alphaAcidPct: lot.alphaAcidPct, itemId: lot.id });
    return { ...h, alphaAcidPct: lot.alphaAcidPct };
  });
  const adjusted = { ...content, hops };
  const computed = computeStats(adjusted, batchSizeL, equipment, await catalogValues(tx, adjusted));
  return { ...computed, alphaAcidFromInventory: fromInventory };
}

// ── Items, low stock, shopping list ───────────────────────────────────

export function createInventoryService(db: Db, opts: { baseUrl: string }) {
  async function authorize(
    tx: Tx,
    user: User | null,
    action: "read" | "edit" | "delete",
    id: string,
  ) {
    const [row] = await tx
      .select({ item: inventoryItems, reserved: reservedSum })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, id));
    if (!row) throw new ApiError(404, "not_found", "Inventory item not found");
    await authorizeRow(tx, user, action, "inventory_item", row.item, "Inventory item");
    return { ...row.item, reserved: row.reserved };
  }

  /** Your inventory, or a brewery's you belong to. */
  function scope(viewer: User | null, breweryId: string | undefined): Owner {
    const user = signedIn(viewer);
    if (!breweryId) return { ownerUserId: user.id, ownerBreweryId: null };
    if (!user.memberships.some((m) => m.breweryId === breweryId)) {
      throw new ApiError(404, "not_found", "Brewery not found");
    }
    return { ownerUserId: null, ownerBreweryId: breweryId };
  }

  async function withReserved(tx: Tx, where: SQL | undefined) {
    const rows = await tx
      .select({ item: inventoryItems, reserved: reservedSum })
      .from(inventoryItems)
      .where(where)
      .orderBy(asc(inventoryItems.name), asc(inventoryItems.id));
    return rows.map((r) => view({ ...r.item, reserved: r.reserved }));
  }

  return {
    /** Items by name; `q` searches name, catalog id, lot and location. */
    async list(
      viewer: User | null,
      page: {
        breweryId?: string | undefined;
        q?: string | undefined;
        limit: number;
        offset: number;
      },
    ) {
      const owner = scope(viewer, page.breweryId);
      const like = page.q ? `%${page.q.replace(/[\\%_]/g, "\\$&")}%` : undefined;
      const rows = await db
        .select({ item: inventoryItems, reserved: reservedSum })
        .from(inventoryItems)
        .where(
          and(
            ownerIs(owner),
            like
              ? or(
                  ilike(inventoryItems.name, like),
                  ilike(inventoryItems.catalogId, like),
                  ilike(inventoryItems.lot, like),
                  ilike(inventoryItems.location, like),
                )
              : undefined,
          ),
        )
        .orderBy(asc(inventoryItems.name), asc(inventoryItems.id))
        .limit(page.limit + 1)
        .offset(page.offset);
      return {
        items: rows.slice(0, page.limit).map((r) => view({ ...r.item, reserved: r.reserved })),
        nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
      };
    },

    async create(viewer: User | null, input: z.infer<typeof CreateInventoryItem>) {
      const user = signedIn(viewer);
      const { breweryId, ...fields } = input;
      const owner = newOwner(user, breweryId);
      return db.transaction(async (tx) => {
        const id = await newId(tx);
        const [row] = await tx
          .insert(inventoryItems)
          .values({ ...fields, id, uri: `${opts.baseUrl}/inventory/${id}`, ...owner })
          .returning();
        return view({ ...(row as ItemRow), reserved: 0 });
      });
    },

    async get(viewer: User | null, id: string) {
      return view(await authorize(db, viewer, "read", id));
    },

    async update(viewer: User | null, id: string, patch: z.infer<typeof InventoryItemPatch>) {
      return db.transaction(async (tx) => {
        const current = await authorize(tx, viewer, "edit", id);
        const [row] = await tx
          .update(inventoryItems)
          .set(patch)
          .where(eq(inventoryItems.id, id))
          .returning();
        return view({ ...(row as ItemRow), reserved: current.reserved });
      });
    },

    /** Deleting an item drops its reservations too. */
    async remove(viewer: User | null, id: string) {
      await db.transaction(async (tx) => {
        await authorize(tx, viewer, "delete", id);
        await tx
          .delete(shares)
          .where(and(eq(shares.resourceType, "inventory_item"), eq(shares.resourceId, id)));
        await tx.delete(inventoryItems).where(eq(inventoryItems.id, id));
      });
    },

    /** Items with less available than their low-stock threshold. */
    async lowStock(viewer: User | null, breweryId: string | undefined) {
      const owner = scope(viewer, breweryId);
      return { items: await withReserved(db, and(ownerIs(owner), lowStockWhere)) };
    },

    /**
     * What to buy: what planned batches need beyond what's available, in the order they were
     * planned, plus items below their threshold.
     */
    async shoppingList(viewer: User | null, breweryId: string | undefined) {
      const owner = scope(viewer, breweryId);
      return db.transaction(async (tx) => {
        const stock = await stockOf(tx, owner, false);
        const planned = await tx
          .select()
          .from(batches)
          .where(
            and(
              eq(batches.status, "planned"),
              owner.ownerBreweryId
                ? eq(batches.ownerBreweryId, owner.ownerBreweryId)
                : eq(batches.ownerUserId, owner.ownerUserId as string),
            ),
          )
          .orderBy(asc(batches.createdAt), asc(batches.id));
        const short = new Map<
          string,
          ReturnType<typeof allocate>["short"][number] & { batches: { id: string; name: string }[] }
        >();
        for (const batch of planned) {
          const { content } = await batchContent(tx, batch);
          for (const s of allocate(linesOf(content), stock).short) {
            const key = `${s.catalogId ?? s.name.trim().toLowerCase()}|${s.unit}`;
            const entry = short.get(key) ?? { ...s, short: 0, batches: [] };
            entry.short += s.short;
            if (!entry.batches.some((b) => b.id === batch.id)) {
              entry.batches.push({ id: batch.id, name: batch.name });
            }
            short.set(key, entry);
          }
        }
        return {
          short: [...short.values()],
          lowStock: await withReserved(tx, and(ownerIs(owner), lowStockWhere)),
        };
      });
    },
  };
}

const lowStockWhere = sql`${inventoryItems.lowStockThreshold} IS NOT NULL AND ${inventoryItems.quantity} - ${reservedSum} < ${inventoryItems.lowStockThreshold}`;

export type InventoryService = ReturnType<typeof createInventoryService>;
