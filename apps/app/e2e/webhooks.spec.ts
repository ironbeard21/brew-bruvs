// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { receiverUrl, withWebhookReceiver } from "../../server/test/webhook-journey.ts";

test("delivers a signed webhook from Integrations to a test receiver", async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, "Set TEST_DATABASE_URL for the webhook journey");
  test.setTimeout(60_000);

  await withWebhookReceiver(async ({ baseUrl, deliveries, deliverOne }) => {
    await page.goto(`${baseUrl}/connect`);
    await page.getByTestId("connect-submit-button").click();
    await expect(page).toHaveURL(`${baseUrl}/login`);

    await page.getByTestId("auth-display-name-input").fill("Webhook Brewer");
    await page.getByTestId("auth-email-input").fill("webhook@brew.test");
    await page.getByTestId("auth-password-input").fill("webhook-test-password");
    await page.getByTestId("auth-setup-submit").click();
    await expect(page.getByTestId("signed-in-name")).toHaveText("Webhook Brewer");

    await page.getByTestId("nav-settings").click();
    await page.getByTestId("subnav-integrations").click();
    await page.getByRole("tab", { name: "Outgoing webhooks" }).click();

    const hookName = "Playwright receiver";
    await page.getByTestId("webhook-name-input").fill(hookName);
    await page.getByTestId("webhook-url-input").fill(receiverUrl);
    await page.getByTestId("webhook-create-button").click();
    const key = page.getByTestId("issued-webhook-key");
    await expect(key).not.toBeEmpty();
    const signingKey = (await key.textContent())?.trim() ?? "";
    await page.getByTestId("dismiss-webhook-secret-button").click();

    const status = page.locator('[data-testid^="webhook-status-"]');
    await expect(status).toHaveText("Pending first delivery");
    await page.getByRole("button", { name: `Send test event to ${hookName}` }).click();
    await expect(page.getByTestId("webhook-notice")).toContainText("Test event queued");

    expect(await deliverOne()).toBe(true);
    expect(deliveries).toHaveLength(1);
    const [delivery] = deliveries;
    if (!delivery) throw new Error("Expected the receiver to get a delivery");
    expect(delivery.deliveryId).toBeTruthy();
    expect(JSON.parse(delivery.body.toString("utf8"))).toMatchObject({
      type: "webhook.test",
      deliveryId: delivery.deliveryId,
    });
    expect(delivery.signature).toBe(
      `sha256=${createHmac("sha256", signingKey).update(delivery.body).digest("hex")}`,
    );

    await page.getByTestId("webhooks-refresh-button").click();
    await expect(status).toHaveText("Healthy");
  });
});
