// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import type { Address } from "../src/integrations/public-target.ts";
import { createWebhookSender } from "../src/integrations/send-webhook.ts";
import { createWebhookService } from "../src/services/webhooks.ts";
import { call, offlineDeps, TEST_DATABASE_URL, twoUsers, withApp } from "./helpers.ts";

const publicAddress = { address: "93.184.216.34", family: 4 };
const url = "https://hooks.example.test/receive";
const path = "/api/integrations/webhooks";

it("pins a public address, signs the exact bytes, refuses changed DNS, and rejects redirects", async () => {
  const resolve = vi.fn(async () => [publicAddress]);
  const send = vi.fn(
    async (_url: URL, _target: Address, _body: string, _headers: Record<string, string>) => 302,
  );
  const sender = createWebhookSender(resolve, send);
  expect(await sender.validate(url)).toBe(url);
  expect(await sender.deliver(url, "test-key", "job-id", { type: "test" })).toBe(false);
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1);
  const [, address, payload, headers] = send.mock.calls[0] ?? [];
  expect(address).toEqual(publicAddress);
  expect(headers?.["Brew-Bruvs-Delivery"]).toBe("job-id");
  expect(JSON.parse(payload ?? "{}")).toEqual({ type: "test", deliveryId: "job-id" });
  expect(headers?.["Brew-Bruvs-Signature"]).toBe(
    `sha256=${createHmac("sha256", "test-key")
      .update(payload ?? "")
      .digest("hex")}`,
  );
  resolve.mockResolvedValue([publicAddress, { address: "127.0.0.1", family: 4 }]);
  await expect(sender.deliver(url, "test-key", "job-id", {})).rejects.toThrow("public destination");
  await expect(sender.validate("https://[::1]/")).rejects.toThrow("public destination");
  expect(send).toHaveBeenCalledTimes(1);
});

it("requires a session to list subscriptions", async () => {
  expect((await call(createApp(offlineDeps()), "GET", path)).status).toBe(401);
});

describe.skipIf(!TEST_DATABASE_URL)("webhook API and durable worker", () => {
  it("delivers batch events and test sends, retries with backoff, and exposes failure without the signing key", async () => {
    const events: { id: string; body: string; signature: string }[] = [];
    let status = 204;
    const sender = createWebhookSender(
      async () => [publicAddress],
      async (_url, _address, body, headers) => {
        events.push({
          id: headers["Brew-Bruvs-Delivery"] ?? "",
          body,
          signature: headers["Brew-Bruvs-Signature"] ?? "",
        });
        return status;
      },
    );
    await withApp({ webhookSender: sender }, async (app, sql, db) => {
      const { adminToken: token, annToken } = await twoUsers(app);
      const worker = createWebhookService(db, sender);
      const post = (target: string, body?: unknown) => call(app, "POST", target, { token, body });
      const recipe = await post("/api/recipes", {
        name: "Webhook test",
        beverage: "beer",
        batchSizeL: 20,
        content: {
          schemaVersion: 1,
          fermentables: [],
          hops: [],
          yeasts: [],
          miscs: [],
          mash: [],
          fermentation: [],
        },
      });
      expect(recipe.status).toBe(201);
      const batch = await post("/api/batches", { recipeId: recipe.json.id });
      expect(batch.status).toBe(201);
      expect((await post(path, { name: "Private", url: "http://127.0.0.1" })).status).toBe(400);
      const created = await post(path, { name: "Test receiver", url, batchId: batch.json.id });
      expect(created.status).toBe(201);
      const key = created.json.signingKey as string;
      const target = `${path}/${created.json.id}`;
      expect((await call(app, "POST", `${target}/test`, { token: annToken })).status).toBe(404);

      const batchPath = `/api/batches/${batch.json.id}`;
      expect((await post(`${batchPath}/status`, { status: "brewing" })).status).toBe(200);
      expect(
        (
          await post(`${batchPath}/readings`, {
            takenAt: "2026-11-23T10:00:00Z",
            gravitySg: 1.048,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await post(`${batchPath}/reminders`, {
            dueAt: "2026-01-01T10:00:00Z",
            kind: "custom",
          })
        ).status,
      ).toBe(201);
      await worker.enqueueDue();
      await worker.enqueueDue();
      expect((await post(`${target}/test`)).status).toBe(202);
      expect((await post(`${target}/test`)).status).toBe(202);
      const afterEnqueue = new Date(Date.now() + 1_000);
      for (let i = 0; i < 4; i++) expect(await worker.deliverOne(afterEnqueue)).toBe(true);
      expect(await worker.deliverOne()).toBe(false);
      expect(events.map((event) => JSON.parse(event.body).type).sort()).toEqual([
        "batch.status_changed",
        "reading.logged",
        "reminder.due",
        "webhook.test",
      ]);
      for (const event of events) {
        expect(JSON.parse(event.body).deliveryId).toBe(event.id);
        expect(event.signature).toBe(
          `sha256=${createHmac("sha256", key).update(event.body).digest("hex")}`,
        );
      }

      status = 500;
      expect((await post(`${target}/test`)).status).toBe(202);
      let now = new Date(Date.now() + 1_000);
      expect(await worker.deliverOne(now)).toBe(true);
      expect(await worker.deliverOne(now)).toBe(false);
      for (const delay of [30_000, 120_000, 600_000, 1_800_000]) {
        now = new Date(now.getTime() + delay);
        expect(await worker.deliverOne(now)).toBe(true);
      }
      expect(await worker.deliverOne(now)).toBe(false);
      expect(new Set(events.slice(4).map((event) => event.id)).size).toBe(1);
      const list = await call(app, "GET", path, { token });
      expect(list.json.items).toMatchObject([
        { id: created.json.id, failing: true, lastDeliveredAt: expect.any(String) },
      ]);
      expect(JSON.stringify(list.json)).not.toContain(key);
      expect((await sql.query("SELECT count(*)::int AS n FROM webhook_jobs")).rows[0]?.n).toBe(1);
      status = 204;
      expect((await post(`${target}/test`)).status).toBe(202);
      expect(await worker.deliverOne(new Date(now.getTime() + 1_000))).toBe(true);
      const recovered = await call(app, "GET", path, { token });
      expect(recovered.json.items).toMatchObject([{ id: created.json.id, failing: false }]);
      expect((await sql.query("SELECT count(*)::int AS n FROM webhook_jobs")).rows[0]?.n).toBe(0);
      expect((await post(`${target}/test`)).status).toBe(202);
      const limited = await post(`${target}/test`);
      expect(limited.status).toBe(429);
      expect(limited.res.headers.get("Retry-After")).toBeTruthy();
      expect((await call(app, "DELETE", target, { token: annToken })).status).toBe(404);
      expect((await call(app, "DELETE", target, { token })).status).toBe(204);
      expect((await sql.query("SELECT count(*)::int AS n FROM webhook_jobs")).rows[0]?.n).toBe(0);
    });
  }, 20_000);
});
