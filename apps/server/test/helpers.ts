// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the app for tests: offline (no database) or against a fresh migrated Postgres database.
import { APP_ROLE, createDb, migrateUp } from "@brew-bruvs/db";
import { withTestDatabase } from "@brew-bruvs/db/testing";
import { Client } from "pg";
import { expect } from "vitest";
import { type AppDeps, createApp } from "../src/app.ts";
import type { Oidc } from "../src/auth/oidc.ts";
import { createLogger } from "../src/logger.ts";
import { createActivityService } from "../src/services/activity.ts";
import { createAuthService } from "../src/services/auth.ts";
import { createBatchService } from "../src/services/batches.ts";
import { createBreweryService } from "../src/services/breweries.ts";
import { createBrewfatherService } from "../src/services/brewfather.ts";
import { createCatalogService } from "../src/services/catalog.ts";
import { createDeviceService } from "../src/services/device-readings.ts";
import { createEquipmentItemService } from "../src/services/equipment-items.ts";
import { createEquipmentProfileService } from "../src/services/equipment-profiles.ts";
import { createInventoryService } from "../src/services/inventory.ts";
import { createNoteService } from "../src/services/notes.ts";
import { createRecipeFileService } from "../src/services/recipe-files.ts";
import { createRecipeService } from "../src/services/recipes.ts";
import { createSharingService } from "../src/services/sharing.ts";
import { createWebhookService } from "../src/services/webhooks.ts";

export const BASE_URL = "http://brew.test";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function deps(
  db: ReturnType<typeof createDb>["db"],
  signupMode: "open" | "invite",
  oidc?: Oidc,
  readRecipeUrl?: Parameters<typeof createRecipeFileService>[1],
  fetchBrewfather?: Parameters<typeof createBrewfatherService>[1],
  webhookSender?: Parameters<typeof createWebhookService>[1],
): AppDeps {
  const profiles = createEquipmentProfileService(db, { baseUrl: BASE_URL });
  return {
    logger: createLogger("error", () => {}),
    webDir: undefined,
    catalog: createCatalogService(db),
    profiles,
    devices: createDeviceService(db, { baseUrl: BASE_URL }),
    equipmentItems: createEquipmentItemService(db, { baseUrl: BASE_URL }),
    recipes: createRecipeService(db, { baseUrl: BASE_URL, profiles }),
    recipeFiles: createRecipeFileService(db, readRecipeUrl),
    batches: createBatchService(db, { baseUrl: BASE_URL, profiles }),
    notes: createNoteService(db, { baseUrl: BASE_URL }),
    breweries: createBreweryService(db, { baseUrl: BASE_URL }),
    brewfather: createBrewfatherService(db, fetchBrewfather),
    inventory: createInventoryService(db, { baseUrl: BASE_URL }),
    webhooks: createWebhookService(db, webhookSender),
    sharing: createSharingService(db),
    activity: createActivityService(db),
    auth: {
      auth: createAuthService(db, { baseUrl: BASE_URL, signupMode }),
      oidc,
      baseUrl: BASE_URL,
      signupMode,
      // Tests send X-Forwarded-For to act as different clients.
      trustProxy: true,
    },
  };
}

/** For routes that never touch the database. pg connects lazily, so nothing is opened. */
export function offlineDeps(): AppDeps {
  return deps(createDb("postgres://unused@localhost/unused").db, "invite");
}

export type TestApp = ReturnType<typeof createApp>;

/** Runs `run` with an app on its own freshly migrated database, dropped afterwards. */
export async function withApp(
  opts: {
    signupMode?: "open" | "invite";
    oidc?: Oidc;
    readRecipeUrl?: Parameters<typeof createRecipeFileService>[1];
    fetchBrewfather?: Parameters<typeof createBrewfatherService>[1];
    webhookSender?: Parameters<typeof createWebhookService>[1];
  },
  run: (app: TestApp, sql: Client, jobs: ReturnType<typeof createDb>["db"]) => Promise<void>,
): Promise<void> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  await withTestDatabase(TEST_DATABASE_URL, async (url) => {
    const sql = new Client({ connectionString: url });
    // As the server runs: brew_app, under row-level security. Jobs (the webhook worker) get the
    // owner connection, as in the server.
    const { db, close } = createDb(url, { role: APP_ROLE });
    const jobs = createDb(url);
    try {
      await sql.connect();
      await migrateUp(sql);
      await run(
        createApp(
          deps(
            db,
            opts.signupMode ?? "invite",
            opts.oidc,
            opts.readRecipeUrl,
            opts.fetchBrewfather,
            opts.webhookSender,
          ),
        ),
        sql,
        jobs.db,
      );
    } finally {
      await close();
      await jobs.close();
      await sql.end();
    }
  });
}

export const admin = { email: "admin@brew.test", password: "admin-password", displayName: "Admin" };
export const ann = { email: "ann@brew.test", password: "ann-password", displayName: "Ann" };

export type Json = Record<string, unknown> & { error?: { code: string; message: string } };

/** One request; `ip` sets X-Forwarded-For so tests can act as different clients. */
export async function call(
  app: TestApp,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    token?: string | undefined;
    cookie?: string | undefined;
    ip?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await app.request(path, init);
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json, res };
}

/** Runs setup and returns the admin's app token. */
export async function setupAdmin(app: TestApp): Promise<string> {
  const r = await call(app, "POST", "/api/setup", { body: { ...admin, client: "app" } });
  expect(r.status).toBe(201);
  return r.json.token as string;
}

export async function invite(app: TestApp, adminToken: string): Promise<string> {
  const r = await call(app, "POST", "/api/invites", { token: adminToken });
  expect(r.status).toBe(201);
  return r.json.code as string;
}

/** Admin plus Ann (invited), both signed in with app tokens. */
export async function twoUsers(app: TestApp) {
  const adminToken = await setupAdmin(app);
  const code = await invite(app, adminToken);
  const r = await call(app, "POST", "/api/auth/signup", {
    body: { ...ann, inviteCode: code, client: "app" },
  });
  expect(r.status).toBe(201);
  const annId = (r.json.user as { id: string }).id;
  return { adminToken, annToken: r.json.token as string, annId };
}
