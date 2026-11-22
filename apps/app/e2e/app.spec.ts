// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";

test.describe("Brew-Bruvs app shell", () => {
  test("connects to server, switches servers, and runs the ABV calculator", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");

    // First launch routes to the server-address screen.
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByText("Connect to a Brew-Bruvs Server")).toBeVisible();

    const serverInput = page.getByTestId("server-address-input");
    await expect(serverInput).toHaveValue(baseURL ?? "");

    // Connect verifies /healthz via @brew-bruvs/api-contract and navigates to /login.
    await page.getByTestId("connect-submit-button").click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("connected-server-url")).toHaveText(baseURL ?? "");
    await expect(page.getByTestId("server-health-status")).toContainText("healthy");

    // Switch server navigates back to /connect with the server saved.
    await page.getByTestId("switch-server-button").click();
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByText("Saved Servers")).toBeVisible();

    // Navigate to Calculators and run the ABV calculator.
    await page.getByTestId("nav-calculators").click();
    await expect(page).toHaveURL(/\/calculators$/);

    await page.getByTestId("abv-og-input").fill("1.064");
    await page.getByTestId("abv-fg-input").fill("1.014");
    // (1.064 - 1.014) * 131.25 = 6.5625 -> 6.56%
    await expect(page.getByTestId("abv-standard-result")).toHaveText("6.56%");

    // Toggle US -> Metric and verify Hydrometer temperature unit conversion.
    await page.getByRole("tab", { name: "Hydrometer temperature correction calculator" }).click();
    await expect(page.getByTestId("hydro-corrected-result")).toHaveText("1.052");

    await page.getByRole("tab", { name: "Use Metric units" }).click();
    await expect(page.getByTestId("hydro-sample-temp-input")).toHaveValue("23.9");
    await expect(page.getByTestId("hydro-corrected-result")).toHaveText("1.052");
  });

  test("calculators work completely offline without a server", async ({ page, context }) => {
    await page.goto("/connect");
    await page.getByTestId("use-offline-button").click();
    await expect(page).toHaveURL(/\/calculators$/);

    // Simulate airplane mode: block all network traffic.
    await context.setOffline(true);

    await page.getByTestId("abv-og-input").fill("1.080");
    await page.getByTestId("abv-fg-input").fill("1.020");
    // (1.080 - 1.020) * 131.25 = 7.875 -> 7.88%
    await expect(page.getByTestId("abv-standard-result")).toHaveText("7.88%");

    await page.getByRole("tab", { name: "Refractometer correction calculator" }).click();
    await expect(page.getByTestId("refrac-fg-result")).toHaveText("1.012");

    await page.getByRole("tab", { name: "Brewing unit converter" }).click();
    await expect(page.getByTestId("converter-result-plato")).toHaveText("12.39");

    await context.setOffline(false);
  });
});
