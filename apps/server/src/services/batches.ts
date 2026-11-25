// SPDX-License-Identifier: AGPL-3.0-or-later
// Batches made from recipe versions: status moves with history, readings, and reminders.
// Moving a mead to primary (pitching) schedules its nutrient doses from brew-math.
import { NUTRIENT_NITROGEN_FRACTION, nutrientPlan } from "@brew-bruvs/brew-math";
import { type Db, schema } from "@brew-bruvs/db";
import { and, asc, desc, eq, isNull, lte, max } from "drizzle-orm";
import type { z } from "zod";
import type {
  BatchStatus,
  CreateBatch,
  ReadingInput,
  ReadingPatch,
  ReminderInput,
} from "../contracts/batches.ts";
import { MEASUREMENTS } from "../contracts/batches.ts";
import { ApiError } from "../errors.ts";
import type { Action, User } from "../permissions.ts";
import { authorizeRow, newId, newOwner, ownerOf, readableBy, signedIn, type Tx } from "./access.ts";
import { recordActivity } from "./activity.ts";
import type { EquipmentProfileService } from "./equipment-profiles.ts";
import { batchStats, reservationsOf, syncReservations } from "./inventory.ts";
import { versionStats } from "./recipe-stats.ts";

const {
  batches,
  batchStatusChanges,
  readings,
  reminders,
  recipes,
  recipeVersions,
  shares,
  BEER_STATUSES,
  AGED_STATUSES,
} = schema;

type Status = z.infer<typeof BatchStatus>;
type BatchRow = typeof batches.$inferSelect;
type ReadingRow = typeof readings.$inferSelect;

const HOUR = 3_600_000;
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** A beverage's statuses in order. */
const flowOf = (beverage: BatchRow["beverage"]): readonly Status[] =>
  beverage === "beer" ? BEER_STATUSES : AGED_STATUSES;

/** Any later status (skipping is fine), or one step back to undo a mistake. */
export function allowedStatuses(beverage: BatchRow["beverage"], current: Status): Status[] {
  const flow = flowOf(beverage);
  const i = flow.indexOf(current);
  return [...(i > 0 ? [flow[i - 1] as Status] : []), ...flow.slice(i + 1)];
}

function viewReading(r: ReadingRow) {
  return {
    id: r.id,
    batchId: r.batchId,
    takenAt: r.takenAt.toISOString(),
    gravitySg: r.gravitySg,
    temperatureC: r.temperatureC,
    ph: r.ph,
    brix: r.brix,
    titratableAcidityGPerL: r.titratableAcidityGPerL,
    freeSo2MgPerL: r.freeSo2MgPerL,
    source: r.source,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

function viewReminder(r: typeof reminders.$inferSelect, batchName: string) {
  return {
    id: r.id,
    batchId: r.batchId,
    batchName,
    kind: r.kind,
    dueAt: r.dueAt.toISOString(),
    note: r.note,
    doneAt: iso(r.doneAt),
    createdAt: r.createdAt.toISOString(),
  };
}

export function createBatchService(
  db: Db,
  opts: { baseUrl: string; profiles: EquipmentProfileService },
) {
  const { profiles } = opts;

  const batchColumns = {
    batch: batches,
    recipeId: recipeVersions.recipeId,
    version: recipeVersions.version,
  };

  /** Loads a batch and checks `action` on it; locks the row for updates when asked. */
  async function authorize(tx: Tx, user: User | null, action: Action, id: string, lock = false) {
    const query = tx
      .select(batchColumns)
      .from(batches)
      .innerJoin(recipeVersions, eq(recipeVersions.id, batches.recipeVersionId))
      .where(eq(batches.id, id));
    const [row] = await (lock ? query.for("update", { of: batches }) : query);
    if (!row) throw new ApiError(404, "not_found", "Batch not found");
    await authorizeRow(tx, user, action, "batch", row.batch, "Batch");
    return row;
  }

  function viewBatch(row: { batch: BatchRow; recipeId: string; version: number }) {
    const b = row.batch;
    const owner = ownerOf(b);
    return {
      id: b.id,
      uri: b.uri,
      name: b.name,
      beverage: b.beverage,
      status: b.status,
      visibility: b.visibility,
      owner: owner as NonNullable<typeof owner>,
      recipe: { id: row.recipeId, version: row.version, versionId: b.recipeVersionId },
      batchSizeL: b.batchSizeL,
      equipmentProfileId: b.equipmentProfileId,
      brewedAt: iso(b.brewedAt),
      completedAt: iso(b.completedAt),
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  async function detail(tx: Tx, row: { batch: BatchRow; recipeId: string; version: number }) {
    const history = await tx
      .select({ status: batchStatusChanges.status, changedAt: batchStatusChanges.changedAt })
      .from(batchStatusChanges)
      .where(eq(batchStatusChanges.batchId, row.batch.id))
      .orderBy(asc(batchStatusChanges.changedAt), asc(batchStatusChanges.id));
    return {
      ...viewBatch(row),
      statusHistory: history.map((h) => ({
        status: h.status,
        changedAt: h.changedAt.toISOString(),
      })),
      allowedStatuses: allowedStatuses(row.batch.beverage, row.batch.status),
    };
  }

  async function recordStatus(tx: Tx, batchId: string, status: Status, userId: string, at: Date) {
    const [row] = await tx
      .insert(batchStatusChanges)
      .values({ batchId, status, changedAt: at, changedByUserId: userId })
      .returning({ id: batchStatusChanges.id });
    return (row as { id: string }).id;
  }

  /**
   * Two nutrient doses from brew-math's plan: 24 hours after pitching, and at the 1/3 sugar
   * break, expected about 72 hours in (the note gives the gravity to check against).
   * Assumes medium nitrogen need and Fermaid-K unless the recipe lists DAP.
   */
  async function scheduleNutrients(tx: Tx, batch: BatchRow, pitchedAt: Date, userId: string) {
    const [version] = await tx
      .select()
      .from(recipeVersions)
      .where(eq(recipeVersions.id, batch.recipeVersionId));
    const v = version as typeof recipeVersions.$inferSelect;
    const { stats, statsError, content } = await versionStats(tx, v);
    if (!stats) return { added: [], error: `No nutrient schedule: ${statsError}` };
    const dap = content.miscs.some(
      (m) => m.kind === "nutrient" && /\bDAP\b|diammonium/i.test(m.name),
    );
    const nutrient = dap ? "DAP" : "Fermaid-K";
    const plan = nutrientPlan({
      volumeL: batch.batchSizeL ?? v.batchSizeL,
      og: stats.og,
      expectedFg: stats.fg,
      need: "medium",
      nitrogenFraction: NUTRIENT_NITROGEN_FRACTION[dap ? "dap" : "fermaid-k"],
    });
    if (!plan.ok) return { added: [], error: `No nutrient schedule: ${plan.error.message}` };
    const [first, second] = plan.value.doses;
    const grams = (g: number | undefined) => `${(g ?? 0).toFixed(1)} g ${nutrient}`;
    const rows = await tx
      .insert(reminders)
      .values([
        {
          batchId: batch.id,
          kind: "nutrient" as const,
          dueAt: new Date(pitchedAt.getTime() + 24 * HOUR),
          note: `Nutrient dose 1 of 2: ${grams(first?.grams)}, 24 hours after pitching`,
          createdByUserId: userId,
        },
        {
          batchId: batch.id,
          kind: "nutrient" as const,
          dueAt: new Date(pitchedAt.getTime() + 72 * HOUR),
          note: `Nutrient dose 2 of 2: ${grams(second?.grams)} at the 1/3 sugar break, about SG ${plan.value.oneThirdBreakSg.toFixed(3)}. Check your gravity first.`,
          createdByUserId: userId,
        },
      ])
      .returning();
    return { added: rows.map((r) => viewReminder(r, batch.name)), error: null };
  }

  async function readingOf(tx: Tx, batchId: string, readingId: string) {
    const [row] = await tx
      .select()
      .from(readings)
      .where(and(eq(readings.id, readingId), eq(readings.batchId, batchId)));
    if (!row) throw new ApiError(404, "not_found", "Reading not found");
    return row;
  }

  /** Contributors change their own readings; changing anyone else's needs edit. */
  async function ownReadingOrEdit(tx: Tx, viewer: User | null, id: string, readingId: string) {
    await authorize(tx, viewer, "contribute", id);
    const current = await readingOf(tx, id, readingId);
    if (!viewer || current.createdByUserId !== viewer.id) await authorize(tx, viewer, "edit", id);
    return current;
  }

  return {
    async list(
      viewer: User | null,
      page: { status?: Status | undefined; mine: boolean; limit: number; offset: number },
    ) {
      if (page.mine && !viewer) throw new ApiError(401, "unauthorized", "Sign in first");
      const access =
        page.mine && viewer
          ? eq(batches.ownerUserId, viewer.id)
          : readableBy(db, viewer, "batch", batches);
      const rows = await db
        .select(batchColumns)
        .from(batches)
        .innerJoin(recipeVersions, eq(recipeVersions.id, batches.recipeVersionId))
        .where(and(access, page.status ? eq(batches.status, page.status) : undefined))
        .orderBy(desc(batches.updatedAt), desc(batches.id))
        .limit(page.limit + 1)
        .offset(page.offset);
      return {
        items: rows.slice(0, page.limit).map(viewBatch),
        nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
      };
    },

    /** Brew any recipe you can read; the batch is yours and starts private and planned. */
    async create(viewer: User | null, input: z.infer<typeof CreateBatch>) {
      const user = signedIn(viewer);
      const owner = newOwner(user, input.breweryId);
      return db.transaction(async (tx) => {
        const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, input.recipeId));
        if (!recipe) throw new ApiError(404, "not_found", "Recipe not found");
        await authorizeRow(tx, user, "read", "recipe", recipe, "Recipe");
        let versionNumber = input.version;
        if (versionNumber === undefined) {
          const [latest] = await tx
            .select({ n: max(recipeVersions.version) })
            .from(recipeVersions)
            .where(eq(recipeVersions.recipeId, recipe.id));
          versionNumber = latest?.n ?? 1;
        }
        const [version] = await tx
          .select()
          .from(recipeVersions)
          .where(
            and(eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.version, versionNumber)),
          );
        if (!version) throw new ApiError(404, "not_found", "Recipe version not found");

        let profileId: string | null = null;
        if (input.equipmentProfileId) {
          if (!(await profiles.readable(tx, user, input.equipmentProfileId))) {
            throw new ApiError(
              400,
              "unknown_equipment_profile",
              "No equipment profile with that id",
            );
          }
          profileId = input.equipmentProfileId;
        } else if (input.equipmentProfileId === undefined && version.equipmentProfileId) {
          const readable = await profiles.readable(tx, user, version.equipmentProfileId);
          profileId = readable ? version.equipmentProfileId : null;
        }

        const id = await newId(tx);
        const [batch] = await tx
          .insert(batches)
          .values({
            id,
            uri: `${opts.baseUrl}/batches/${id}`,
            ...owner,
            recipeVersionId: version.id,
            name: input.name ?? version.name,
            beverage: recipe.beverage,
            batchSizeL: input.batchSizeL ?? version.batchSizeL,
            equipmentProfileId: profileId,
          })
          .returning();
        const row = batch as BatchRow;
        await recordStatus(tx, id, "planned", user.id, row.createdAt);
        return detail(tx, { batch: row, recipeId: recipe.id, version: version.version });
      });
    },

    async get(viewer: User | null, id: string) {
      return db.transaction(async (tx) => detail(tx, await authorize(tx, viewer, "read", id)));
    },

    async setStatus(viewer: User | null, id: string, status: Status) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const row = await authorize(tx, user, "edit", id, true);
        const { batch } = row;
        if (!allowedStatuses(batch.beverage, batch.status).includes(status)) {
          throw new ApiError(
            409,
            "invalid_status_move",
            `A ${batch.beverage} batch can't move from ${batch.status} to ${status}`,
          );
        }
        const now = new Date();
        const started = status === "brewing" || status === "primary";
        const [updated] = await tx
          .update(batches)
          .set({
            status,
            ...(started && !batch.brewedAt ? { brewedAt: now } : {}),
            completedAt: status === "finished" ? now : null,
          })
          .where(eq(batches.id, id))
          .returning();
        const changeId = await recordStatus(tx, id, status, user.id, now);
        const inventory = await syncReservations(tx, updated as BatchRow, batch.status, status);
        const feed = { breweryId: batch.ownerBreweryId, actorUserId: user.id };
        await recordActivity(tx, {
          ...feed,
          verb: batch.status === "planned" ? "batch_started" : "batch_moved",
          objectType: "batch_status_change",
          objectId: changeId,
        });
        if (inventory?.used) {
          await recordActivity(tx, {
            ...feed,
            verb: "inventory_used",
            objectType: "batch",
            objectId: id,
          });
        }

        let schedule: { added: ReturnType<typeof viewReminder>[]; error: string | null } = {
          added: [],
          error: null,
        };
        if (batch.beverage === "mead" && status === "primary") {
          // Only once: an undo and redo of the move doesn't add a second schedule.
          const [existing] = await tx
            .select({ id: reminders.id })
            .from(reminders)
            .where(and(eq(reminders.batchId, id), eq(reminders.kind, "nutrient")));
          if (!existing) schedule = await scheduleNutrients(tx, updated as BatchRow, now, user.id);
        }
        return {
          batch: await detail(tx, { ...row, batch: updated as BatchRow }),
          addedReminders: schedule.added,
          scheduleError: schedule.error,
          inventory,
        };
      });
    },

    /** Deletes the batch with its readings, reminders, history and notes. */
    async remove(viewer: User | null, id: string) {
      await db.transaction(async (tx) => {
        await authorize(tx, viewer, "delete", id, true);
        await tx
          .delete(shares)
          .where(and(eq(shares.resourceType, "batch"), eq(shares.resourceId, id)));
        await tx.delete(batches).where(eq(batches.id, id));
      });
    },

    /** What the batch holds from inventory: reserved, used, or given back. */
    async reservations(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        await authorize(tx, viewer, "read", id);
        return reservationsOf(tx, id);
      });
    },

    /** Stats for the batch as brewed: its size, equipment, and the hop lots it holds. */
    async stats(viewer: User | null, id: string) {
      return db.transaction(async (tx) =>
        batchStats(tx, (await authorize(tx, viewer, "read", id)).batch),
      );
    },

    async readings(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        await authorize(tx, viewer, "read", id);
        const rows = await tx
          .select()
          .from(readings)
          .where(eq(readings.batchId, id))
          .orderBy(asc(readings.takenAt), asc(readings.id));
        return rows.map(viewReading);
      });
    },

    async addReading(viewer: User | null, id: string, input: z.infer<typeof ReadingInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const { batch } = await authorize(tx, user, "contribute", id);
        const [row] = await tx
          .insert(readings)
          .values({
            ...input,
            takenAt: new Date(input.takenAt),
            batchId: id,
            createdByUserId: user.id,
          })
          .returning();
        await recordActivity(tx, {
          breweryId: batch.ownerBreweryId,
          actorUserId: user.id,
          verb: "reading_logged",
          objectType: "reading",
          objectId: (row as ReadingRow).id,
        });
        return viewReading(row as ReadingRow);
      });
    },

    async updateReading(
      viewer: User | null,
      id: string,
      readingId: string,
      patch: z.infer<typeof ReadingPatch>,
    ) {
      return db.transaction(async (tx) => {
        const current = await ownReadingOrEdit(tx, viewer, id, readingId);
        if (Object.keys(patch).length === 0) return viewReading(current);
        const merged = { ...current, ...patch };
        if (!MEASUREMENTS.some((k) => merged[k] != null)) {
          throw new ApiError(400, "validation_error", "A reading needs at least one measurement");
        }
        const { takenAt, ...rest } = patch;
        const [row] = await tx
          .update(readings)
          .set({ ...rest, ...(takenAt ? { takenAt: new Date(takenAt) } : {}) })
          .where(eq(readings.id, readingId))
          .returning();
        return viewReading(row as ReadingRow);
      });
    },

    async removeReading(viewer: User | null, id: string, readingId: string) {
      await db.transaction(async (tx) => {
        await ownReadingOrEdit(tx, viewer, id, readingId);
        await tx.delete(readings).where(eq(readings.id, readingId));
      });
    },

    async reminders(viewer: User | null, id: string) {
      return db.transaction(async (tx) => {
        const { batch } = await authorize(tx, viewer, "read", id);
        const rows = await tx
          .select()
          .from(reminders)
          .where(eq(reminders.batchId, id))
          .orderBy(asc(reminders.dueAt), asc(reminders.id));
        return rows.map((r) => viewReminder(r, batch.name));
      });
    },

    async addReminder(viewer: User | null, id: string, input: z.infer<typeof ReminderInput>) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const { batch } = await authorize(tx, user, "edit", id);
        const [row] = await tx
          .insert(reminders)
          .values({
            batchId: id,
            kind: input.kind,
            dueAt: new Date(input.dueAt),
            note: input.note ?? null,
            createdByUserId: user.id,
          })
          .returning();
        return viewReminder(row as typeof reminders.$inferSelect, batch.name);
      });
    },

    /**
     * Open reminders due by `until`, across the batches that are the user's own or shared with
     * them (not other people's public batches), soonest first.
     */
    async due(viewer: User | null, until: Date) {
      const user = signedIn(viewer);
      const rows = await db
        .select({ reminder: reminders, batchName: batches.name })
        .from(reminders)
        .innerJoin(batches, eq(batches.id, reminders.batchId))
        .where(
          and(
            readableBy(db, user, "batch", batches, { visibility: false }),
            isNull(reminders.doneAt),
            lte(reminders.dueAt, until),
          ),
        )
        .orderBy(asc(reminders.dueAt), asc(reminders.id));
      return rows.map((r) => viewReminder(r.reminder, r.batchName));
    },

    async markDone(viewer: User | null, reminderId: string) {
      return db.transaction(async (tx) => {
        const [found] = await tx
          .select({ batchId: reminders.batchId })
          .from(reminders)
          .where(eq(reminders.id, reminderId));
        if (!found) throw new ApiError(404, "not_found", "Reminder not found");
        try {
          await authorize(tx, viewer, "edit", found.batchId);
        } catch (err) {
          // Someone who can't see the batch can't see its reminders either.
          if (err instanceof ApiError && err.status === 404) {
            throw new ApiError(404, "not_found", "Reminder not found");
          }
          throw err;
        }
        const [row] = await tx
          .select({ reminder: reminders, batchName: batches.name })
          .from(reminders)
          .innerJoin(batches, eq(batches.id, reminders.batchId))
          .where(eq(reminders.id, reminderId));
        const r = row as NonNullable<typeof row>;
        if (r.reminder.doneAt) return viewReminder(r.reminder, r.batchName);
        const [done] = await tx
          .update(reminders)
          .set({ doneAt: new Date() })
          .where(eq(reminders.id, reminderId))
          .returning();
        return viewReminder(done as typeof reminders.$inferSelect, r.batchName);
      });
    },
  };
}

export type BatchService = ReturnType<typeof createBatchService>;
