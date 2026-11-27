// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@brew-bruvs/db";
import { z } from "@hono/zod-openapi";
import { AllowedActions, EquipmentProfile, EquipmentProfileInput, Visibility } from "./recipes.ts";

const dimensions = {
  batchSizeL: true,
  boilSizeL: true,
  kettleVolumeL: true,
  kettleLossL: true,
  boilRateLPerHr: true,
  mashTunVolumeL: true,
  grainAbsorptionLPerKg: true,
} as const;

const Condition = z.enum(schema.equipmentCondition.enumValues);
const text = (max: number) => z.string().trim().min(1).max(max);
const fields = EquipmentProfileInput.pick(dimensions).extend({
  name: text(100),
  type: text(100).nullable().optional(),
  condition: Condition.nullable().optional(),
  notes: text(2_000).nullable().optional(),
});

export const EquipmentItemInput = fields
  .extend({
    name: fields.shape.name.optional(),
    catalogId: text(200).optional(),
    breweryId: z.uuid().optional(),
  })
  .refine((value) => value.name || value.catalogId, {
    message: "Give a name or start from a catalog item",
    path: ["name"],
  })
  .openapi("EquipmentItemInput");

export const EquipmentItemPatch = fields.partial().openapi("EquipmentItemPatch");
export const EquipmentHolderInput = z
  .strictObject({
    heldByUserId: z.uuid().nullable().openapi({ description: "Null returns the item" }),
  })
  .openapi("EquipmentHolderInput");

export const EquipmentItem = EquipmentProfile.pick(dimensions)
  .extend({
    id: z.uuid(),
    uri: z.string(),
    catalogId: z.string().nullable(),
    owner: z.object({ type: z.enum(["user", "brewery"]), id: z.uuid() }),
    visibility: Visibility,
    name: z.string(),
    type: z.string().nullable(),
    condition: Condition.nullable(),
    notes: z.string().nullable(),
    heldByUserId: z.uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("EquipmentItem");

export const EquipmentItemDetail = EquipmentItem.extend({ can: AllowedActions }).openapi(
  "EquipmentItemDetail",
);

export const EquipmentItemPage = z
  .object({ items: z.array(EquipmentItem), nextOffset: z.int().nonnegative().nullable() })
  .openapi("EquipmentItemPage");

export type EquipmentItemInput = z.infer<typeof EquipmentItemInput>;
export type EquipmentItemPatch = z.infer<typeof EquipmentItemPatch>;
