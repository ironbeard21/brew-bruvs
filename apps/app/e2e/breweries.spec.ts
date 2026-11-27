// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, type Page, test } from "@playwright/test";
import { webDir, withBrowserServer } from "../../server/test/browser-server.ts";
import {
  admin,
  call,
  invite,
  setupAdmin,
  TEST_DATABASE_URL,
  type TestApp,
  withApp,
} from "../../server/test/helpers.ts";

const breweryName = "Three Rivers Brewery";
const recipeName = "Three Rivers Pale";
const maltName = "Club Pale Malt";
const startedBatchName = "First Pale";
const plannedBatchName = "Next Pale";
const member = {
  email: "club-member@brew.test",
  displayName: "Club Member",
  password: "club-member-password",
};
const brewer = {
  email: "club-brewer@brew.test",
  displayName: "Club Brewer",
  password: "club-brewer-password",
};

async function createAccount(app: TestApp, ownerToken: string, user: typeof member) {
  const signup = await call(app, "POST", "/api/auth/signup", {
    body: { ...user, inviteCode: await invite(app, ownerToken), client: "app" },
  });
  expect(signup.status).toBe(201);
  return signup.json.token as string;
}

async function signIn(page: Page, baseUrl: string, user: typeof member) {
  await page.goto(`${baseUrl}/connect`);
  await page.getByTestId("connect-submit-button").click();
  await expect(page).toHaveURL(`${baseUrl}/login`);
  await page.getByTestId("auth-email-input").fill(user.email);
  await page.getByTestId("auth-password-input").fill(user.password);
  await page.getByTestId("auth-login-submit").click();
  await expect(page.getByTestId("signed-in-name")).toHaveText(user.displayName);
}

async function planBatch(page: Page, name: string) {
  await page.getByTestId("nav-batches").click();
  await page.getByTestId("new-batch-button").click();
  await page.getByRole("radio").filter({ hasText: recipeName }).click();
  await page.getByTestId("new-batch-name-input").fill(name);
  await page.getByTestId("create-batch-submit-button").click();
  await expect(page).toHaveURL(/\/batches\/[0-9a-f-]+$/);
  await expect(page.getByTestId("batch-current-status")).toContainText("Planned");
  return page.url();
}

test("brewery invitations, Member contributions, and shared inventory across three users", async ({
  page: ownerPage,
  browser,
}) => {
  test.skip(!TEST_DATABASE_URL, "Set TEST_DATABASE_URL for the multi-user brewery journey");
  test.setTimeout(90_000);

  await withBrowserServer(async (baseUrl, serve) => {
    await withApp({ baseUrl, webDir }, async (app) => {
      serve(app.fetch);
      const ownerToken = await setupAdmin(app);
      await createAccount(app, ownerToken, member);
      const brewerToken = await createAccount(app, ownerToken, brewer);
      const units = await call(app, "PATCH", "/api/me", {
        token: brewerToken,
        body: { units: "metric" },
      });
      expect(units.status).toBe(200);

      await using memberContext = await browser.newContext();
      await using brewerContext = await browser.newContext();
      const memberPage = await memberContext.newPage();
      const brewerPage = await brewerContext.newPage();

      const breweryId =
        await test.step("Owner and Member use a one-time brewery invitation", async () => {
          await signIn(ownerPage, baseUrl, admin);
          await ownerPage.getByTestId("nav-breweries").click();
          await ownerPage.getByTestId("create-brewery-name-input").fill(breweryName);
          await ownerPage.getByTestId("create-brewery-submit").click();
          await expect(ownerPage).toHaveURL(/\/breweries\/[0-9a-f-]+$/);
          await expect(ownerPage.getByTestId("my-brewery-role-badge")).toHaveText("Owner");

          const inviteRole = ownerPage.getByRole("tablist", { name: "Role for invited member" });
          await inviteRole.getByRole("tab", { name: "Member role", exact: true }).click();
          await ownerPage.getByTestId("create-brewery-invite-button").click();
          const code = ownerPage.getByTestId("brewery-invite-code-value");
          await expect(code).not.toBeEmpty();

          await signIn(memberPage, baseUrl, member);
          await memberPage.getByTestId("nav-breweries").click();
          await memberPage
            .getByTestId("join-invite-code-input")
            .fill((await code.textContent()) ?? "");
          await memberPage.getByTestId("join-invite-code-submit").click();
          await expect(memberPage).toHaveURL(ownerPage.url());
          await expect(memberPage.getByTestId("my-brewery-role-badge")).toHaveText("Member");
          await expect(memberPage.getByTestId("brewery-invites-section")).toHaveCount(0);
          return new URL(ownerPage.url()).pathname.split("/").at(-1) as string;
        });

      await test.step("The third user accepts an email invitation as Brewer", async () => {
        await ownerPage.getByRole("tab", { name: "Invite a server member by email" }).click();
        const inviteRole = ownerPage.getByRole("tablist", { name: "Role for invited member" });
        await inviteRole.getByRole("tab", { name: "Brewer role", exact: true }).click();
        await ownerPage.getByTestId("brewery-invite-email-input").fill(brewer.email);
        await ownerPage.getByTestId("create-brewery-invite-button").click();
        await expect(ownerPage.getByTestId("brewery-invite-notice")).toBeVisible();

        await signIn(brewerPage, baseUrl, brewer);
        await brewerPage.getByTestId("nav-breweries").click();
        await brewerPage.getByRole("button", { name: `Accept invite to ${breweryName}` }).click();
        await expect(brewerPage).toHaveURL(ownerPage.url());
        await expect(brewerPage.getByTestId("my-brewery-role-badge")).toHaveText("Brewer");

        await ownerPage.reload();
        const roster = ownerPage.getByTestId("brewery-members-list");
        for (const [name, role] of [
          [admin.displayName, "Owner"],
          [member.displayName, "Member"],
          [brewer.displayName, "Brewer"],
        ] as const) {
          const row = roster.locator('[data-testid^="member-row-"]', { hasText: name });
          await expect(row.locator('[data-testid^="member-role-"]')).toHaveText(role);
        }
      });

      // Set up matching brewery and personal lots so the shortage proves the scope.
      const breweryStock = await call(app, "POST", "/api/inventory", {
        token: ownerToken,
        body: { breweryId, name: maltName, quantity: 3, quantityUnit: "kg" },
      });
      expect(breweryStock.status).toBe(201);
      const personalStock = await call(app, "POST", "/api/inventory", {
        token: brewerToken,
        body: { name: maltName, quantity: 10, quantityUnit: "kg" },
      });
      expect(personalStock.status).toBe(201);

      const { recipeUrl, batchUrl } =
        await test.step("Brewer reserves brewery malt and sees the next batch's shortage", async () => {
          await brewerPage.getByTestId("nav-recipes").click();
          await brewerPage.getByTestId("new-recipe-button").click();
          await brewerPage.getByTestId("recipe-name-input").fill(recipeName);
          await brewerPage.getByTestId("fermentable-search-input").fill(maltName);
          await brewerPage.getByTestId("fermentable-add-custom").click();
          await brewerPage.getByTestId("ferm-0-amount").fill("2");
          await brewerPage.getByTestId("recipe-save-button").click();
          await expect(brewerPage).toHaveURL(/\/recipes\/[0-9a-f-]+$/);
          await expect(brewerPage.getByTestId("recipe-owner-badge")).toContainText(breweryName);
          const recipeUrl = brewerPage.url();

          const batchUrl = await planBatch(brewerPage, startedBatchName);
          await brewerPage.getByTestId("status-step-brewing").click();
          await expect(brewerPage.getByTestId("batch-current-status")).toContainText("Brewing");
          await brewerPage
            .getByRole("tab", { name: "Batch inventory reservations and lot stats" })
            .click();
          const reservation = brewerPage.getByTestId("batch-reservation-item-0");
          await expect(reservation).toContainText(maltName);
          await expect(reservation).toContainText("2.00 kg");
          await expect(reservation).toContainText("reserved");

          const plannedUrl = await planBatch(brewerPage, plannedBatchName);
          await brewerPage
            .getByRole("tab", { name: "Batch inventory reservations and lot stats" })
            .click();
          await brewerPage.getByTestId("batch-section-open-shopping").click();
          await expect(brewerPage.getByTestId("shopping-list-panel")).toContainText(breweryName);
          const short = brewerPage.getByTestId("shopping-short-list");
          await expect(short).toContainText(maltName);
          await expect(short).toContainText("Need 1.00 kg");
          await short
            .getByRole("button", { name: `Open planned batch ${plannedBatchName}` })
            .click();
          await expect(brewerPage).toHaveURL(plannedUrl);

          return { recipeUrl, batchUrl };
        });

      await test.step("Member logs readings and notes while brew controls stay read-only", async () => {
        await memberPage.goto(recipeUrl);
        await expect(memberPage.getByTestId("recipe-owner-badge")).toContainText(breweryName);
        await expect(memberPage.getByTestId("recipe-save-button")).toHaveCount(0);

        await memberPage.goto(batchUrl);
        await expect(memberPage.getByTestId("batch-current-status")).toContainText("Brewing");
        await expect(memberPage.getByTestId("status-step-fermenting")).toBeDisabled();
        await expect(memberPage.getByTestId("batch-delete-button")).toHaveCount(0);
        await memberPage.getByTestId("reading-gravity-input").fill("1.042");
        await memberPage.getByTestId("reading-submit-button").click();
        await expect(memberPage.getByTestId("chart-latest-sg")).toHaveText("1.042");

        await memberPage.getByRole("tab", { name: "Batch notes and tasting scores" }).click();
        await memberPage.getByTestId("note-body-input").fill("A steady fermentation.");
        await memberPage.getByTestId("note-submit-button").click();
        await expect(memberPage.getByTestId("note-item-0")).toContainText("A steady fermentation.");

        await brewerPage.goto(batchUrl);
        await expect(brewerPage.getByTestId("chart-latest-sg")).toHaveText("1.042");
        await brewerPage.getByRole("tab", { name: "Batch notes and tasting scores" }).click();
        await expect(brewerPage.getByTestId("note-item-0")).toContainText("A steady fermentation.");
      });
    });
  });
});
