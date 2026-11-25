// SPDX-License-Identifier: AGPL-3.0-or-later
// Batches with their status history, readings, reminders, and notes (including tasting notes).
// Units are SI: litres, °C, specific gravity, g/L, mg/L. Times are ISO 8601 in UTC.

import { schema } from "@brew-bruvs/db";
import { z } from "@hono/zod-openapi";
import { Beverage, Visibility } from "./recipes.ts";

const { TASTING_SCORE_MAX } = schema;

const time = z.iso.datetime({ offset: true });
const litres = z.number().positive().max(100_000);
const owner = z.object({ type: z.enum(["user", "brewery"]), id: z.uuid() });

export const BatchStatus = z
  .enum([
    "planned",
    "brewing",
    "fermenting",
    "conditioning",
    "packaged",
    "primary",
    "secondary",
    "bulk_aging",
    "stabilized",
    "bottled",
    "bottle_aging",
    "finished",
  ])
  .openapi("BatchStatus", {
    description:
      "Beer: planned → brewing → fermenting → conditioning → packaged → finished. Mead, wine, cider: planned → primary → secondary → bulk_aging → stabilized → bottled → bottle_aging → finished.",
  });

// ── Batches ───────────────────────────────────────────────────────────

export const CreateBatch = z
  .strictObject({
    recipeId: z.uuid(),
    version: z.int().positive().optional().openapi({ description: "Defaults to the latest" }),
    name: z.string().trim().min(1).max(200).optional().openapi({
      description: "Defaults to the recipe version's name",
    }),
    batchSizeL: litres.optional().openapi({ description: "Defaults to the version's batch size" }),
    equipmentProfileId: z.uuid().nullable().optional().openapi({
      description: "Defaults to the version's, when you can read it",
    }),
    breweryId: z.uuid().optional().openapi({
      description: "Create it as this brewery's. You must be one of its owners or brewers",
    }),
  })
  .openapi("CreateBatch");

export const Batch = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    name: z.string(),
    beverage: Beverage,
    status: BatchStatus,
    visibility: Visibility,
    owner,
    recipe: z.object({ id: z.uuid(), version: z.int().positive(), versionId: z.uuid() }),
    batchSizeL: z.number().nullable(),
    equipmentProfileId: z.uuid().nullable(),
    brewedAt: z
      .string()
      .nullable()
      .openapi({ description: "Set on the move to brewing or primary" }),
    completedAt: z.string().nullable().openapi({ description: "Set on the move to finished" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Batch");

export const BatchDetail = Batch.extend({
  statusHistory: z.array(z.object({ status: BatchStatus, changedAt: z.string() })),
  allowedStatuses: z.array(BatchStatus).openapi({
    description: "Where the batch can move next: any later status, or one step back",
  }),
}).openapi("BatchDetail");

export const BatchPage = z
  .object({ items: z.array(Batch), nextOffset: z.int().nullable() })
  .openapi("BatchPage");

export const StatusChange = z.strictObject({ status: BatchStatus }).openapi("StatusChange");

// ── Readings ──────────────────────────────────────────────────────────

const measurements = {
  gravitySg: z.number().min(0.98).max(1.3),
  temperatureC: z.number().min(-10).max(110),
  ph: z.number().min(0).max(14),
  brix: z.number().min(-5).max(60),
  titratableAcidityGPerL: z.number().min(0).max(50),
  freeSo2MgPerL: z.number().min(0).max(500),
};
export const MEASUREMENTS = Object.keys(measurements) as (keyof typeof measurements)[];
const hasMeasurement = (
  r: Partial<Record<(typeof MEASUREMENTS)[number], number | null | undefined>>,
) => MEASUREMENTS.some((k) => r[k] != null);

export const ReadingInput = z
  .strictObject({
    takenAt: time,
    gravitySg: measurements.gravitySg.optional(),
    temperatureC: measurements.temperatureC.optional(),
    ph: measurements.ph.optional(),
    brix: measurements.brix.optional(),
    titratableAcidityGPerL: measurements.titratableAcidityGPerL.optional(),
    freeSo2MgPerL: measurements.freeSo2MgPerL.optional(),
    source: z.enum(["manual", "device"]).default("manual"),
    note: z.string().max(2_000).optional(),
  })
  .refine(hasMeasurement, { message: "give at least one measurement" })
  .openapi("ReadingInput");

export const ReadingPatch = z
  .strictObject({
    takenAt: time.optional(),
    gravitySg: measurements.gravitySg.nullable().optional(),
    temperatureC: measurements.temperatureC.nullable().optional(),
    ph: measurements.ph.nullable().optional(),
    brix: measurements.brix.nullable().optional(),
    titratableAcidityGPerL: measurements.titratableAcidityGPerL.nullable().optional(),
    freeSo2MgPerL: measurements.freeSo2MgPerL.nullable().optional(),
    note: z.string().max(2_000).nullable().optional(),
  })
  .openapi("ReadingPatch", { description: "null clears a value; one measurement must remain" });

const num = z.number().nullable();
export const Reading = z
  .object({
    id: z.uuid(),
    batchId: z.uuid(),
    takenAt: z.string(),
    gravitySg: num,
    temperatureC: num,
    ph: num,
    brix: num,
    titratableAcidityGPerL: num,
    freeSo2MgPerL: num,
    source: z.enum(["manual", "device"]),
    note: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Reading");

// ── Reminders ─────────────────────────────────────────────────────────

const ReminderKind = z.enum(["nutrient", "rack", "sulfite", "taste", "ready", "custom"]);

export const ReminderInput = z
  .strictObject({ kind: ReminderKind, dueAt: time, note: z.string().max(2_000).optional() })
  .openapi("ReminderInput");

export const Reminder = z
  .object({
    id: z.uuid(),
    batchId: z.uuid(),
    batchName: z.string(),
    kind: ReminderKind,
    dueAt: z.string(),
    note: z.string().nullable(),
    doneAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Reminder");

export const StatusResult = z
  .object({
    batch: BatchDetail,
    addedReminders: z.array(Reminder).openapi({
      description: "Reminders this move created, e.g. a mead's nutrient schedule on primary",
    }),
    scheduleError: z.string().nullable().openapi({
      description: "Why a mead's nutrient schedule couldn't be made (e.g. the recipe has no stats)",
    }),
  })
  .openapi("StatusResult");

// ── Notes ─────────────────────────────────────────────────────────────

const score = (max: number) => z.int().min(0).max(max).nullable().optional();
export const TastingScores = z
  .strictObject({
    aroma: score(TASTING_SCORE_MAX.aroma),
    appearance: score(TASTING_SCORE_MAX.appearance),
    flavor: score(TASTING_SCORE_MAX.flavor),
    mouthfeel: score(TASTING_SCORE_MAX.mouthfeel),
    overall: score(TASTING_SCORE_MAX.overall),
  })
  .openapi("TastingScores", {
    description:
      "BJCP score sheet: aroma /12, appearance /3, flavor /20, mouthfeel /5, overall /10",
  });

const body = z.string().trim().min(1).max(20_000);

export const NoteInput = z
  .strictObject({
    kind: z.enum(["general", "tasting"]).default("general"),
    body,
    recipeId: z.uuid().optional(),
    batchId: z.uuid().optional(),
    scores: TastingScores.optional(),
    breweryId: z.uuid().optional().openapi({
      description: "Create it as this brewery's. You must be one of its owners or brewers",
    }),
  })
  .refine((n) => !(n.recipeId && n.batchId), {
    message: "a note is about a recipe, a batch, or neither",
  })
  .refine((n) => n.kind === "tasting" || n.scores === undefined, {
    message: "only tasting notes have scores",
    path: ["scores"],
  })
  .openapi("NoteInput");

export const NotePatch = z
  .strictObject({ body: body.optional(), scores: TastingScores.optional() })
  .openapi("NotePatch", { description: "Scores merge into the existing ones; null clears one" });

export const Note = z
  .object({
    id: z.uuid(),
    uri: z.string(),
    kind: z.enum(["general", "tasting"]),
    body: z.string(),
    recipeId: z.uuid().nullable(),
    batchId: z.uuid().nullable(),
    scores: z
      .object({
        aroma: num,
        appearance: num,
        flavor: num,
        mouthfeel: num,
        overall: num,
        total: num.openapi({ description: "Sum of the scores given; null when none are" }),
      })
      .nullable()
      .openapi({ description: "Tasting notes only" }),
    visibility: Visibility,
    owner,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Note");

export const NotePage = z
  .object({ items: z.array(Note), nextOffset: z.int().nullable() })
  .openapi("NotePage");
