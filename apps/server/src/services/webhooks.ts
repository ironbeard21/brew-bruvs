// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Db, schema } from "@brew-bruvs/db";
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { newSecret } from "../auth/secrets.ts";
import type { WebhookInput } from "../contracts/webhooks.ts";
import { ApiError } from "../errors.ts";
import { createWebhookSender } from "../integrations/send-webhook.ts";
import type { User } from "../permissions.ts";
import { denied, newOwner, ownerOf, signedIn, type Tx } from "./access.ts";

const { batches, integrations, reminders, webhookJobs } = schema;
const kind = "webhook_out";
const configSchema = z.object({ url: z.string(), signingKey: z.string() });
const delays = [30_000, 120_000, 600_000, 1_800_000] as const;
type Owner = { ownerUserId: string | null; ownerBreweryId: string | null };
type Batch = Owner & { id: string };
type EventName = "batch.status_changed" | "reading.logged" | "reminder.due";

function scope(owner: Owner) {
  return owner.ownerBreweryId
    ? eq(integrations.ownerBreweryId, owner.ownerBreweryId)
    : eq(integrations.ownerUserId, owner.ownerUserId as string);
}

/**
 * Queues a batch event for the batch owner's webhooks. Through app.queue_batch_webhooks
 * (migration 0009): webhook settings are private to their managers, but anyone who may
 * contribute to the batch can still report on it.
 */
export async function enqueueBatchWebhook(
  tx: Tx,
  batch: Batch,
  type: EventName,
  occurredAt: Date,
  data: Record<string, unknown>,
) {
  await tx.execute(
    sql`SELECT app.queue_batch_webhooks(${batch.id}, ${type}, ${occurredAt.toISOString()}, ${JSON.stringify(data)}::jsonb)`,
  );
}

const failed = sql<boolean>`exists (
  select 1 from ${webhookJobs}
  where "webhook_jobs"."integration_id" = "integrations"."id"
  and "webhook_jobs"."failed_at" is not null
)`;

function view(row: typeof integrations.$inferSelect, failing: boolean) {
  const { url } = configSchema.parse(row.config);
  return {
    id: row.id,
    name: row.name,
    url,
    batchId: row.batchId,
    breweryId: row.ownerBreweryId,
    lastDeliveredAt: row.lastSeenAt?.toISOString() ?? null,
    failing,
  };
}

async function manage(tx: Tx, user: User, id: string) {
  const [row] = await tx
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), eq(integrations.kind, kind)))
    .for("update");
  if (!row) throw new ApiError(404, "not_found", "Webhook not found");
  const error = denied(
    user,
    "edit",
    { owner: ownerOf(row), visibility: "private", shares: [] },
    "Webhook",
  );
  if (error) throw error;
  return row;
}

/**
 * `jobs` runs the worker (due reminders, deliveries). It acts for no user, so in the server it
 * is the owner connection, as ADR-0011 has jobs do.
 */
export function createWebhookService(db: Db, sender = createWebhookSender(), jobs: Db = db) {
  return {
    async list(viewer: User | null, breweryId?: string) {
      const user = signedIn(viewer);
      const owner = newOwner(user, breweryId);
      const rows = await db
        .select({ row: integrations, failed })
        .from(integrations)
        .where(and(eq(integrations.kind, kind), scope(owner)))
        .orderBy(asc(integrations.name), asc(integrations.id));
      return { items: rows.map((r) => view(r.row, r.failed)) };
    },

    async create(viewer: User | null, input: WebhookInput) {
      const user = signedIn(viewer);
      const owner = newOwner(user, input.breweryId);
      const url = await sender.validate(input.url);
      const signingKey = newSecret();
      return db.transaction(async (tx) => {
        if (input.batchId) {
          const [batch] = await tx
            .select()
            .from(batches)
            .where(eq(batches.id, input.batchId))
            .for("share");
          if (
            !batch ||
            batch.ownerUserId !== owner.ownerUserId ||
            batch.ownerBreweryId !== owner.ownerBreweryId
          ) {
            throw new ApiError(404, "not_found", "Batch not found for this webhook owner");
          }
        }
        const [row] = await tx
          .insert(integrations)
          .values({
            ...owner,
            name: input.name,
            batchId: input.batchId,
            kind,
            config: { url, signingKey, batchScoped: Boolean(input.batchId) },
          })
          .returning();
        if (!row) throw new Error("Webhook insert returned no row");
        return { ...view(row, false), signingKey };
      });
    },

    async test(viewer: User | null, id: string) {
      const user = signedIn(viewer);
      await db.transaction(async (tx) => {
        const integration = await manage(tx, user, id);
        const [pending] = await tx
          .select({ id: webhookJobs.id })
          .from(webhookJobs)
          .where(
            and(
              eq(webhookJobs.integrationId, id),
              isNull(webhookJobs.failedAt),
              sql`${webhookJobs.event}->>'type' = 'webhook.test'`,
            ),
          )
          .limit(1);
        if (pending) return;
        await tx.insert(webhookJobs).values({
          integrationId: id,
          event: {
            type: "webhook.test",
            batchId: integration.batchId,
            occurredAt: new Date().toISOString(),
            data: {},
          },
        });
      });
    },

    async remove(viewer: User | null, id: string) {
      const user = signedIn(viewer);
      await db.transaction(async (tx) => {
        await manage(tx, user, id);
        await tx.delete(integrations).where(eq(integrations.id, id));
      });
    },

    async enqueueDue(now = new Date()) {
      await jobs.transaction(async (tx) => {
        const due = await tx
          .select({ reminder: reminders, batch: batches })
          .from(reminders)
          .innerJoin(batches, eq(reminders.batchId, batches.id))
          .where(
            and(
              lte(reminders.dueAt, now),
              isNull(reminders.doneAt),
              isNull(reminders.webhookQueuedAt),
            ),
          )
          .orderBy(asc(reminders.dueAt), asc(reminders.id))
          .limit(20)
          .for("update", { of: reminders, skipLocked: true });
        for (const { reminder, batch } of due) {
          await enqueueBatchWebhook(tx, batch, "reminder.due", now, {
            id: reminder.id,
            kind: reminder.kind,
            dueAt: reminder.dueAt.toISOString(),
          });
          await tx
            .update(reminders)
            .set({ webhookQueuedAt: now })
            .where(eq(reminders.id, reminder.id));
        }
      });
    },

    async deliverOne(now = new Date()) {
      return jobs.transaction(async (tx) => {
        const [item] = await tx
          .select({ job: webhookJobs, integration: integrations })
          .from(webhookJobs)
          .innerJoin(integrations, eq(webhookJobs.integrationId, integrations.id))
          .where(and(isNull(webhookJobs.failedAt), lte(webhookJobs.dueAt, now)))
          .orderBy(asc(webhookJobs.dueAt), asc(webhookJobs.id))
          .limit(1)
          .for("no key update", { skipLocked: true });
        if (!item) return false;
        const { job, integration } = item;
        let delivered = false;
        try {
          const { url, signingKey } = configSchema.parse(integration.config);
          delivered = await sender.deliver(url, signingKey, job.id, job.event);
        } catch {
          // Invalid destinations and network failures follow the retry schedule.
        }
        const delay = delays[job.attempts];
        if (delivered || delay === undefined) {
          // Only the most recent terminal outcome is needed to show the webhook's health.
          await tx
            .delete(webhookJobs)
            .where(
              and(eq(webhookJobs.integrationId, integration.id), isNotNull(webhookJobs.failedAt)),
            );
        }
        if (delivered) {
          await tx.delete(webhookJobs).where(eq(webhookJobs.id, job.id));
          await tx
            .update(integrations)
            .set({ lastSeenAt: now })
            .where(eq(integrations.id, integration.id));
        } else {
          await tx
            .update(webhookJobs)
            .set({
              attempts: job.attempts + 1,
              ...(delay === undefined
                ? { failedAt: now }
                : { dueAt: new Date(now.getTime() + delay) }),
            })
            .where(eq(webhookJobs.id, job.id));
        }
        return true;
      });
    },
  };
}

export type WebhookService = ReturnType<typeof createWebhookService>;
