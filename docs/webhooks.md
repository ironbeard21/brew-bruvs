# Batch webhooks

Create a webhook with `POST /api/integrations/webhooks`. A webhook can cover all batches owned by
the signed-in user, or all batches owned by a brewery where they are an owner or brewer. Set
`batchId` to subscribe to one batch within that scope. The create response shows the signing key.
Save it in the receiver's secret store.

Use `POST /api/integrations/webhooks/{id}/test` to queue a test and
`GET /api/integrations/webhooks` to see the last successful delivery and failing status.
Each subscription can have one pending test. Each user can make up to five test requests per
five minutes.
`DELETE /api/integrations/webhooks/{id}` removes the subscription and its pending deliveries.

The receiver gets a JSON object with `deliveryId`, `type`, `batchId`, `occurredAt`, and `data`. The event types
are `batch.status_changed`, `reading.logged`, `reminder.due`, and `webhook.test`.
Use the original body bytes to calculate HMAC-SHA256 with the signing key. Compare the result
in constant time to the hexadecimal digest in `Brew-Bruvs-Signature: sha256=<digest>`.
Return a 2xx response and use the signed body's `deliveryId` to deduplicate retries.

Brew-Bruvs retries unsuccessful deliveries after 30 seconds, 2 minutes, 10 minutes, and
30 minutes. After the last attempt, the webhook is marked failing. A later success clears
the failing status. Each attempt resolves and checks the receiver's addresses again. Local
and private destinations are refused. Redirects count as failed deliveries.
