// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "@hono/zod-openapi";

export const WebhookInput = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    url: z.url({ protocol: /^https?$/ }).max(2_000),
    breweryId: z.uuid().optional(),
    batchId: z.uuid().optional(),
  })
  .openapi("WebhookInput");

export const Webhook = z
  .object({
    id: z.uuid(),
    name: z.string(),
    url: z.url(),
    batchId: z.uuid().nullable(),
    breweryId: z.uuid().nullable(),
    lastDeliveredAt: z.string().nullable(),
    failing: z.boolean(),
  })
  .openapi("Webhook");

export const IssuedWebhook = Webhook.extend({ signingKey: z.string() }).openapi("IssuedWebhook");

export type WebhookInput = z.infer<typeof WebhookInput>;
