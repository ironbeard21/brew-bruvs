// SPDX-License-Identifier: AGPL-3.0-or-later
import { createWebhookSender } from "../src/integrations/send-webhook.ts";
import { createWebhookService } from "../src/services/webhooks.ts";
import { webDir, withBrowserServer } from "./browser-server.ts";
import { withApp } from "./helpers.ts";

const receiverPath = "/test-webhook-receiver";
export const receiverUrl = `https://hooks.example.test${receiverPath}`;

interface Delivery {
  body: Buffer;
  signature: string | null;
  deliveryId: string | null;
}

export async function withWebhookReceiver(
  run: (fixture: {
    baseUrl: string;
    deliveries: readonly Delivery[];
    deliverOne: () => Promise<boolean>;
  }) => Promise<void>,
) {
  await withBrowserServer(async (baseUrl, serve) => {
    const deliveries: Delivery[] = [];
    // Use the production signing code with a fixture-only destination and HTTP transport.
    const sender = createWebhookSender(
      async (host) =>
        host === "hooks.example.test" ? [{ address: "93.184.216.34", family: 4 }] : [],
      async (url, _address, body, headers, signal) => {
        if (url.href !== receiverUrl) return 404;
        const response = await fetch(baseUrl + receiverPath, {
          method: "POST",
          headers,
          body,
          signal,
          redirect: "error",
        });
        return response.status;
      },
    );

    await withApp({ baseUrl, webDir, webhookSender: sender }, async (app, _sql, db) => {
      serve(async (request) => {
        if (request.method === "POST" && new URL(request.url).pathname === receiverPath) {
          deliveries.push({
            body: Buffer.from(await request.arrayBuffer()),
            signature: request.headers.get("Brew-Bruvs-Signature"),
            deliveryId: request.headers.get("Brew-Bruvs-Delivery"),
          });
          return new Response(null, { status: 204 });
        }
        return app.fetch(request);
      });
      const worker = createWebhookService(db, sender);
      await run({ baseUrl, deliveries, deliverOne: worker.deliverOne });
    });
  });
}
