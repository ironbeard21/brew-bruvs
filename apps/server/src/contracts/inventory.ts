// SPDX-License-Identifier: AGPL-3.0-or-later
// Inventory: ingredients on hand, what batches reserve from them, low stock and the shopping list.
// Quantities are SI in the item's unit: kg, L, or each (packs, tablets, …).

import { z } from "@hono/zod-openapi";
import { RecipeStats } from "./recipes.ts";

const time = z.iso.datetime({ offset: true });
const day = z.iso.date();
const amount = z.number().nonnegative().max(1_000_000);
const text = (max: number) => z.string().trim().min(1).max(max);

export const QuantityUnit = z.enum(["kg", "l", "each"]).openapi("QuantityUnit");

const itemFields = {
  name: text(200),
  catalogId: text(100).nullable().optional().openapi({
    description: "A catalog row's id (e.g. hop-citra); batches match on it before the name",
  }),
  quantity: amount,
  quantityUnit: QuantityUnit,
  lot: text(100).nullable().optional(),
  location: text(100).nullable().optional(),
  alphaAcidPct: z.number().min(0).max(100).nullable().optional().openapi({
    description: "Hops: this lot's alpha acid, used in the stats of batches it is reserved for",
  }),
  purchasedOn: day.nullable().optional(),
  bestBefore: day.nullable().optional(),
  lowStockThreshold: amount.nullable().optional().openapi({
    description: "In the item's unit; it is low on stock when less than this is available",
  }),
  notes: z.string().trim().max(2_000).nullable().optional(),
};

export const CreateInventoryItem = z
  .strictObject({
    ...itemFields,
    breweryId: z.uuid().optional().openapi({
      description: "Add it to this brewery's inventory. You must be one of its owners or brewers",
    }),
  })
  .openapi("CreateInventoryItem");

export const InventoryItemPatch = z
  .strictObject(itemFields)
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: "change at least one field" })
  .openapi("InventoryItemPatch");

export const InventoryItem = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    owner: z.object({ type: z.enum(["user", "brewery"]), id: z.uuid() }),
    name: z.string(),
    catalogId: z.string().nullable(),
    quantity: z.number().openapi({ description: "On hand" }),
    quantityUnit: QuantityUnit,
    reserved: z.number().openapi({ description: "Held by started batches" }),
    available: z.number().openapi({ description: "On hand minus reserved; can be negative" }),
    lot: z.string().nullable(),
    location: z.string().nullable(),
    alphaAcidPct: z.number().nullable(),
    purchasedOn: day.nullable(),
    bestBefore: day.nullable(),
    lowStockThreshold: z.number().nullable(),
    notes: z.string().nullable(),
    createdAt: time,
    updatedAt: time,
  })
  .openapi("InventoryItem");

export const InventoryPage = z
  .object({ items: z.array(InventoryItem), nextOffset: z.int().nullable() })
  .openapi("InventoryPage");

export const InventoryScope = {
  breweryId: z.uuid().optional().openapi({
    description: "A brewery you belong to; leave out for your own inventory",
  }),
};

const Shortfall = z.object({
  name: z.string(),
  catalogId: z.string().nullable(),
  unit: QuantityUnit,
  short: z.number().positive(),
});

export const Reservation = z
  .object({
    itemId: z.uuid(),
    name: z.string(),
    quantity: z.number(),
    unit: QuantityUnit,
    state: z.enum(["reserved", "used", "released"]),
  })
  .openapi("Reservation");

export const InventoryChange = z
  .object({
    reserved: z.array(Reservation).openapi({ description: "Reserved by this move" }),
    short: z.array(Shortfall).openapi({
      description: "What the owner's inventory didn't have; the batch starts anyway",
    }),
    used: z.boolean().openapi({ description: "This move used up the batch's reservations" }),
    released: z.boolean().openapi({ description: "This move gave the reservations back" }),
  })
  .openapi("InventoryChange");

export const BatchReservations = z
  .object({ items: z.array(Reservation) })
  .openapi("BatchReservations");

export const ShoppingList = z
  .object({
    short: z
      .array(
        Shortfall.extend({
          batches: z.array(z.object({ id: z.uuid(), name: z.string() })),
        }),
      )
      .openapi({ description: "What planned batches need beyond what is available" }),
    lowStock: z.array(InventoryItem).openapi({ description: "Items below their threshold" }),
  })
  .openapi("ShoppingList");

export const BatchStats = z
  .object({
    stats: RecipeStats.nullable(),
    statsError: z.string().nullable(),
    alphaAcidFromInventory: z
      .array(z.object({ hop: z.string(), alphaAcidPct: z.number(), itemId: z.uuid() }))
      .openapi({ description: "Hop lines whose alpha acid came from a reserved inventory lot" }),
  })
  .openapi("BatchStats");
