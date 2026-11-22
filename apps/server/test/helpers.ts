// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the app for tests: offline (no database) or against a fresh migrated Postgres database.
import { createDb, migrateUp } from "@brew-bruvs/db";
import { withTestDatabase } from "@brew-bruvs/db/testing";
import { Client } from "pg";
import { type AppDeps, createApp } from "../src/app.ts";
import type { Oidc } from "../src/auth/oidc.ts";
import { createLogger } from "../src/logger.ts";
import { createAuthService } from "../src/services/auth.ts";

export const BASE_URL = "http://brew.test";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function deps(
  db: ReturnType<typeof createDb>["db"],
  signupMode: "open" | "invite",
  oidc?: Oidc,
): AppDeps {
  return {
    logger: createLogger("error", () => {}),
    webDir: undefined,
    auth: {
      auth: createAuthService(db, { baseUrl: BASE_URL, signupMode }),
      oidc,
      baseUrl: BASE_URL,
      signupMode,
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
  opts: { signupMode?: "open" | "invite"; oidc?: Oidc },
  run: (app: TestApp, sql: Client) => Promise<void>,
): Promise<void> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  await withTestDatabase(TEST_DATABASE_URL, async (url) => {
    const sql = new Client({ connectionString: url });
    const { db, close } = createDb(url);
    try {
      await sql.connect();
      await migrateUp(sql);
      await run(createApp(deps(db, opts.signupMode ?? "invite", opts.oidc)), sql);
    } finally {
      await close();
      await sql.end();
    }
  });
}
