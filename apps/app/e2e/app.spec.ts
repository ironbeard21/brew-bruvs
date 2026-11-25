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

    // P1-13: Start a batch from the recipe, advance status, log two readings,
    // and verify both readings appear on the fermentation chart.
    await page.getByTestId("start-batch-button").click();
    await expect(page).toHaveURL(/\/batches\/[0-9a-f-]+$/);
    await expect(page.getByTestId("batch-current-status")).toContainText("Planned");

    await page.getByTestId("status-step-brewing").click();
    await expect(page.getByTestId("batch-current-status")).toContainText("Brewing");

    await page.getByTestId("status-step-fermenting").click();
    await expect(page.getByTestId("batch-current-status")).toContainText("Fermenting");

    // Log first reading (OG)
    await page.getByTestId("reading-gravity-input").fill("1.055");
    await page.getByTestId("reading-temp-input").fill("68");
    await page.getByTestId("reading-note-input").fill("Opening gravity");
    await page.getByTestId("reading-submit-button").click();
    await expect(page.getByTestId("chart-gravity-point-0")).toBeVisible();

    // Log second reading (FG)
    await page.getByTestId("reading-gravity-input").fill("1.012");
    await page.getByTestId("reading-temp-input").fill("69");
    await page.getByTestId("reading-note-input").fill("Terminal gravity");
    await page.getByTestId("reading-submit-button").click();

    // Verify both readings are plotted on the fermentation chart
    await expect(page.getByTestId("fermentation-chart")).toBeVisible();
    await expect(page.getByTestId("chart-gravity-point-0")).toBeVisible();
    await expect(page.getByTestId("chart-gravity-point-1")).toBeVisible();
    await expect(page.getByTestId("chart-latest-sg")).toHaveText("1.012");
    await expect(page.getByTestId("chart-est-abv")).toHaveText("5.64%");

    // Verify Brew Day checklist & timers tab
    await page.getByRole("tab", { name: "Brew day checklist and timers" }).click();
    await expect(page.getByTestId("brew-day-mode")).toBeVisible();
    await page.getByTestId("brew-step-0").click();
    await page.getByTestId("brew-timer-start-0").click();
    await expect(page.getByTestId("brew-timer-pause-0")).toBeVisible();

    // Verify Reminders tab
    await page.getByRole("tab", { name: "Batch reminders" }).click();
    await page.getByTestId("reminder-note-input").fill("Dry hop with Columbus");
    await page.getByTestId("reminder-submit-button").click();
    await expect(page.getByTestId("reminder-pending-0")).toContainText("Dry hop with Columbus");

    // Verify Packaging step embeds the carbonation calculator
    await page.getByRole("tab", { name: "Packaging and carbonation" }).click();
    await expect(page.getByTestId("packaging-step-card")).toBeVisible();
    await expect(page.getByTestId("carb-priming-result")).toBeVisible();

    // Verify Notes & BJCP tasting note
    await page.getByRole("tab", { name: "Batch notes and tasting scores" }).click();
    await page.getByRole("tab", { name: "Tasting Note (BJCP /50)" }).click();
    await page.getByTestId("tasting-score-aroma").fill("10");
    await page.getByTestId("tasting-score-appearance").fill("3");
    await page.getByTestId("tasting-score-flavor").fill("17");
    await page.getByTestId("tasting-score-mouthfeel").fill("4");
    await page.getByTestId("tasting-score-overall").fill("8");
    await page.getByTestId("note-body-input").fill("Clean citrus hop finish.");
    await page.getByTestId("note-submit-button").click();
    await expect(page.getByTestId("note-item-0")).toContainText("42/50 BJCP");

    // Verify batch appears in the Batches list
    await page.getByTestId("nav-batches").click();
    await expect(page).toHaveURL(/\/batches$/);
    await expect(page.getByText(/Backyard Pale Ale/).first()).toBeVisible();

    // P1-14: Import a BeerXML file, review & edit on the review screen, verify credit,
    // save, export BeerXML + BeerJSON, and view the printable brew sheet.
    await page.getByTestId("nav-recipes").click();
    await expect(page).toHaveURL(/\/recipes$/);

    await page.getByTestId("import-recipe-button").click();
    await expect(page).toHaveURL(/\/recipes\/import$/);

    const beerXmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<RECIPES>
  <RECIPE>
    <NAME>Harbor Pale Ale</NAME>
    <VERSION>1</VERSION>
    <TYPE>All Grain</TYPE>
    <BREWER>Robin Brewer</BREWER>
    <BATCH_SIZE>18.927</BATCH_SIZE>
    <BOIL_SIZE>23</BOIL_SIZE>
    <BOIL_TIME>60</BOIL_TIME>
    <EFFICIENCY>72</EFFICIENCY>
    <FERMENTABLES>
      <FERMENTABLE><NAME>Pale Malt (2 Row) US</NAME><VERSION>1</VERSION><TYPE>Grain</TYPE><AMOUNT>4.5</AMOUNT><YIELD>79</YIELD><COLOR>2</COLOR></FERMENTABLE>
    </FERMENTABLES>
    <HOPS>
      <HOP><NAME>Zeus</NAME><VERSION>1</VERSION><ALPHA>16</ALPHA><AMOUNT>0.02</AMOUNT><USE>Boil</USE><TIME>60</TIME><FORM>Pellet</FORM></HOP>
    </HOPS>
    <YEASTS>
      <YEAST><NAME>Safale American Ale</NAME><VERSION>1</VERSION><TYPE>Ale</TYPE><FORM>Dry</FORM><AMOUNT>0.011</AMOUNT><ATTENUATION>81</ATTENUATION></YEAST>
    </YEASTS>
  </RECIPE>
</RECIPES>`;

    await page.getByTestId("import-file-input").setInputFiles({
      name: "harbor-pale.xml",
      mimeType: "application/xml",
      buffer: Buffer.from(beerXmlSample, "utf8"),
    });
    await expect(page.getByTestId("import-selected-filename")).toContainText("harbor-pale.xml");

    await page.getByTestId("import-file-submit-button").click();
    await expect(page.getByTestId("import-review-screen")).toBeVisible();
    await expect(page.getByTestId("import-credit-preview")).toContainText("Robin Brewer");

    // Check and fix amount & title before saving
    await page.getByTestId("recipe-name-input").fill("Harbor Pale Ale (Reviewed)");
    await page.getByTestId("ferm-0-amount").fill("10.0");

    await page.getByTestId("recipe-save-button").click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
    await expect(page.getByTestId("recipe-credit-box")).toContainText("Robin Brewer");

    // Export to BeerXML and BeerJSON
    const xmlDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-beerxml-button").click();
    const xmlDownload = await xmlDownloadPromise;
    expect(xmlDownload.suggestedFilename()).toMatch(/\.xml$/);
    await expect(page.getByTestId("export-success-banner")).toContainText("BEERXML");

    const jsonDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-beerjson-button").click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);

    // Open printable brew sheet
    await page.getByTestId("open-brew-sheet-button").click();
    await expect(page).toHaveURL(/\/recipes\/brew-sheet\?id=/);
    await expect(page.getByTestId("brew-sheet-title")).toHaveText("Harbor Pale Ale (Reviewed)");
    await expect(page.getByTestId("brew-sheet-credit")).toContainText("Robin Brewer");
    await expect(page.getByTestId("print-brew-sheet-button")).toBeVisible();

    // P1-15: Settings (display name, server-synced units, personal API tokens),
    // Admin (sign-up mode, invite code, users & reset link), and About (AGPL + catalog attribution).
    await page.getByTestId("nav-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    // Update display name & units preference on server, then restore defaults for subsequent runs
    await page.getByTestId("settings-display-name-input").fill("Master Brewer");
    await page.getByRole("tab", { name: "Metric SI units" }).click();
    await page.getByTestId("settings-save-profile-button").click();
    await expect(page.getByTestId("settings-profile-saved")).toBeVisible();

    await page.getByTestId("settings-display-name-input").fill("Head Brewer");
    await page.getByRole("tab", { name: "US customary units" }).click();
    await page.getByTestId("settings-save-profile-button").click();
    await expect(page.getByTestId("settings-profile-saved")).toBeVisible();

    // Create & revoke personal API token
    await page.getByTestId("token-name-input").fill("E2E Bridge Token");
    await page.getByTestId("token-create-button").click();
    await expect(page.getByTestId("new-token-secret")).toBeVisible();
    await expect(page.getByTestId("new-token-value")).not.toBeEmpty();

    // Open Admin panel: verify sign-up mode, create invite, generate reset link
    await page.getByTestId("subnav-admin").click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("admin-signup-mode")).toContainText(/Invite-only|Open/);

    await page.getByTestId("admin-create-invite-button").click();
    await expect(page.getByTestId("admin-invite-code")).toBeVisible();

    await page.locator('[data-testid^="admin-reset-link-button-"]').first().click();
    await expect(page.getByTestId("admin-reset-link-value")).toContainText(
      "/reset-password#token=",
    );

    // Open About page: verify AGPL license, source link, and live catalog attribution
    await page.getByTestId("nav-about").click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByTestId("about-license-box")).toContainText("AGPL-3.0-or-later");
    const health = await page.request.get("/healthz");
    expect(health.ok()).toBe(true);
    const { sourceUrl } = await health.json();
    await expect(page.getByTestId("about-source-code-link")).toContainText(
      sourceUrl ?? "https://github.com/ironbeard21/brew-bruvs",
    );
    await expect(page.getByTestId("about-catalog-sources")).toContainText("MIT");

    // P2-11: Create a brewery, generate a one-time invite code, switch workspace,
    // and verify brewery ownership badge on a brewery recipe.
    const breweryName = `Northside Brew Club (${test.info().project.name})`;
    await page.getByTestId("nav-breweries").click();
    await expect(page).toHaveURL(/\/breweries$/);
    await expect(page.getByTestId("brewery-hub")).toBeVisible();

    await page.getByTestId("create-brewery-name-input").fill(breweryName);
    await page.getByTestId("create-brewery-city-input").fill("Portland");
    await page.getByTestId("create-brewery-state-input").fill("OR");
    await page.getByTestId("create-brewery-submit").click();
    await expect(page).toHaveURL(/\/breweries\/[0-9a-f-]+$/);
    await expect(page.getByTestId("my-brewery-role-badge")).toHaveText("Owner");
    await expect(page.getByTestId("leave-blocked-sole-owner")).toBeVisible();

    await page.getByTestId("create-brewery-invite-button").click();
    await expect(page.getByTestId("brewery-invite-code-value")).not.toBeEmpty();

    // Workspace switched to the new brewery; create a brewery-owned recipe and verify owner badge
    await page.getByTestId("nav-recipes").click();
    await expect(page).toHaveURL(/\/recipes$/);
    await page.getByTestId("new-recipe-button").click();
    await expect(page).toHaveURL(/\/recipes\/new$/);
    await page.getByTestId("recipe-name-input").fill("Club House Pale");
    await page.getByTestId("recipe-save-button").click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
    await expect(page.getByTestId("recipe-owner-badge")).toContainText(breweryName);

    // Switch back to personal ("Me") workspace
    await page.getByTestId("workspace-switch-me").click();

    // P2-12: Inventory list & editor in user's units, scan-friendly search, shopping list,
    // and batch start showing what gets reserved and what's short.
    const lotTag = `LOT-E2E-${test.info().project.name}`;
    await page.getByTestId("nav-inventory").click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByTestId("inventory-panel")).toBeVisible();

    await page.getByTestId("inventory-add-button").click();
    await page.getByTestId("inventory-toggle-catalog-picker").click();
    await page.getByTestId("inv-catalog-search-input").fill("Pale Malt (2 Row) US");
    await page.getByTestId("inv-catalog-option-ferm-pale-malt-2-row-us").click();
    await page.getByTestId("inventory-quantity-input").fill("10");
    await page.getByTestId("inventory-threshold-input").fill("12");
    await page.getByTestId("inventory-location-input").fill("Grain Room");
    await page.getByTestId("inventory-lot-input").fill(lotTag);
    await page.getByTestId("inventory-editor-submit").click();

    // Scan-friendly search by lot code finds the new item with Low stock badge
    await page.getByTestId("inventory-search-input").fill(lotTag);
    await expect(page.locator('[data-testid^="inventory-item-"]').first()).toContainText(
      "Pale Malt (2 Row) US",
    );
    await expect(page.locator('[data-testid^="low-stock-badge-"]').first()).toBeVisible();
    await page.getByTestId("inventory-search-clear").click();

    // Shopping list shows the low-stock item
    await page.getByRole("tab", { name: "Shopping list and low-stock items" }).click();
    await expect(page.getByTestId("shopping-lowstock-list")).toContainText("Pale Malt (2 Row) US");

    // Start a new batch from Backyard Pale Ale -> reserves Pale Malt and reports short ingredients
    await page.getByTestId("nav-batches").click();
    await expect(page).toHaveURL(/\/batches$/);
    await page.getByTestId("new-batch-button").click();
    await page
      .locator('[data-testid^="pick-recipe-"]', { hasText: "Backyard Pale Ale" })
      .first()
      .click();
    await page.getByTestId("new-batch-name-input").fill("Inventory Reserved Pale");
    await page.getByTestId("create-batch-submit-button").click();
    await expect(page).toHaveURL(/\/batches\/[0-9a-f-]+$/);

    await page.getByTestId("status-step-brewing").click();
    await expect(page.getByTestId("batch-inventory-change")).toBeVisible();
    await expect(page.getByTestId("batch-inventory-reserved-summary")).toContainText(
      "Pale Malt (2 Row) US",
    );
    await expect(page.getByTestId("batch-inventory-short-summary")).toBeVisible();

    // Verify persistent reservations tab on batch detail
    await page.getByRole("tab", { name: "Batch inventory reservations and lot stats" }).click();
    await expect(page.getByTestId("batch-reservations-list")).toContainText("Pale Malt (2 Row) US");

    // Cross-workspace batch link check: create a brewery batch, switch workspace to Me,
    // start the brewery batch, and verify "Open shopping list" lands on the brewery's shopping list.
    await page.locator('[data-testid^="workspace-switch-"]', { hasText: breweryName }).click();
    await page.getByTestId("nav-batches").click();
    await page.getByTestId("new-batch-button").click();
    await page
      .locator('[data-testid^="pick-recipe-"]', { hasText: "Backyard Pale Ale" })
      .first()
      .click();
    await page.getByTestId("new-batch-name-input").fill("Brewery Shortfall Pale");
    await page.getByTestId("create-batch-submit-button").click();
    await expect(page).toHaveURL(/\/batches\/[0-9a-f-]+$/);
    const breweryBatchUrl = page.url();

    await page.getByTestId("workspace-switch-me").click();
    await page.goto(breweryBatchUrl);
    await page.getByTestId("status-step-brewing").click();
    await expect(page.getByTestId("batch-open-shopping-list-button")).toBeVisible();
    await page.getByTestId("batch-open-shopping-list-button").click();
    await expect(page).toHaveURL(/\/inventory\?tab=shopping&breweryId=/);
    await expect(page.getByTestId("shopping-list-panel")).toContainText(breweryName);

    // Leave workspace cleanly back on Me
    await page.getByTestId("workspace-switch-me").click();
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
