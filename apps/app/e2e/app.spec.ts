// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "@playwright/test";

test.describe("Brew-Bruvs app shell", () => {
  test("connects to server, logs in, switches servers, and runs the ABV calculator", async ({
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

    // First run on a fresh server shows admin setup; subsequent runs show standard login.
    const setupSubmit = page.getByTestId("auth-setup-submit");
    const loginSubmit = page.getByTestId("auth-login-submit");
    await expect(setupSubmit.or(loginSubmit)).toBeVisible();

    // The fresh Compose database must expose setup to the first browser project.
    if (process.env.PLAYWRIGHT_BASE_URL && test.info().project.name === "desktop") {
      await expect(setupSubmit).toBeVisible();
    }

    if (await setupSubmit.isVisible()) {
      await page.getByTestId("auth-display-name-input").fill("Head Brewer");
      await page.getByTestId("auth-email-input").fill("admin@brew.test");
      await page.getByTestId("auth-password-input").fill("hop-secret-123");
      await setupSubmit.click();
      await expect(page.getByTestId("signed-in-name")).toHaveText("Head Brewer");

      // Sign out and verify real email/password login flow (including wrong password rejection).
      await page.getByTestId("logout-button").click();
      await expect(loginSubmit).toBeVisible();
    }

    await page.getByTestId("auth-email-input").fill("admin@brew.test");
    await page.getByTestId("auth-password-input").fill("wrong-password");
    await loginSubmit.click();
    await expect(page.getByTestId("auth-error")).toContainText("Wrong email or password");

    await page.getByTestId("auth-password-input").fill("hop-secret-123");
    await loginSubmit.click();
    await expect(page.getByTestId("signed-in-name")).toHaveText("Head Brewer");
    await expect(page.getByTestId("signed-in-email")).toHaveText("admin@brew.test");

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

    // Switch back to US units before building a recipe in US gallons/pounds/ounces.
    await page.getByRole("tab", { name: "Use US units" }).click();

    // P1-12: Create a recipe using catalog search (including alias Zeus -> Columbus)
    // and verify live OG, FG, ABV, IBU, and Color land inside BJCP 18B American Pale Ale.
    await page.getByTestId("nav-recipes").click();
    await expect(page).toHaveURL(/\/recipes$/);

    await page.getByTestId("new-recipe-button").click();
    await expect(page).toHaveURL(/\/recipes\/new$/);

    await page.getByTestId("recipe-name-input").fill("Backyard Pale Ale");

    // Pick BJCP 2015 18B American Pale Ale
    await page.getByTestId("style-search-input").fill("American Pale Ale");
    await page.getByTestId("style-option-style-bjcp-2015-18b").click();
    await expect(page.getByTestId("stats-style-name")).toContainText("American Pale Ale");

    // Add Pale Malt (2 Row) US (9.8 lb)
    await page.getByTestId("fermentable-search-input").fill("Pale Malt (2 Row) US");
    await page.getByTestId("fermentable-option-ferm-pale-malt-2-row-us").click();
    await page.getByTestId("ferm-0-amount").fill("9.8");

    // Add Caramel/Crystal Malt – 60L (0.75 lb)
    await page.getByTestId("fermentable-search-input").fill("Caramel/Crystal Malt – 60L");
    await page.getByTestId("fermentable-option-ferm-caramel-crystal-malt-60l").click();
    await page.getByTestId("ferm-1-amount").fill("0.75");

    // Search hop by alias "Zeus" -> finds Columbus (0.6 oz @ 60 min)
    await page.getByTestId("hop-search-input").fill("Zeus");
    await page.getByTestId("hop-option-hop-columbus").click();
    await page.getByTestId("hop-0-amount").fill("0.6");

    // Add Safale US-05 yeast
    await page.getByTestId("yeast-search-input").fill("Safale American Ale");
    await page.getByTestId("yeast-option-yeast-fermentis-us-05").click();

    // Verify all 5 live stats land inside style ranges
    await expect(page.getByTestId("fit-og")).toHaveText("Inside");
    await expect(page.getByTestId("fit-fg")).toHaveText("Inside");
    await expect(page.getByTestId("fit-abv")).toHaveText("Inside");
    await expect(page.getByTestId("fit-ibu")).toHaveText("Inside");
    await expect(page.getByTestId("fit-color")).toHaveText("Inside");

    // Save recipe and verify detail view + Fork credit
    await page.getByTestId("recipe-save-button").click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
    await expect(page.getByTestId("version-item-1")).toBeVisible();

    await page.getByTestId("recipe-fork-button").click();
    await expect(page.getByTestId("recipe-forked-from-box")).toContainText("Forked from");
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

    // Verify new P1-11 calculators and formula-on-tap disclosure also work offline.
    await page.getByRole("tab", { name: "Strike and sparge water calculator" }).click();
    await expect(page.getByTestId("strike-temp-result")).toContainText("°F");
    await page.getByTestId("formula-toggle").click();
    await expect(page.getByTestId("formula-content")).toContainText("0.41 / r");

    await page
      .getByRole("tab", { name: "Carbonation priming sugar and keg PSI calculator" })
      .click();
    await expect(page.getByTestId("carb-priming-result")).toContainText("oz");

    await page
      .getByRole("tab", { name: "Stabilize with sorbate and backsweeten calculator" })
      .click();
    await expect(page.getByTestId("stabilize-sorbate-result")).toContainText("g");

    await context.setOffline(false);
  });
});
