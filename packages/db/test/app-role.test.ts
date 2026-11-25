// SPDX-License-Identifier: AGPL-3.0-or-later
// The server's role (row-level security, ADR-0011): restored grants and its own login.
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { ensureAppRole, migrateUp } from "../src/migrations.ts";
import { withTestDatabase } from "./test-database.ts";

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)("brew_app on Postgres (TEST_DATABASE_URL)", () => {
  it("gets its grants back after a restore without privileges, and signs in under the policies", async () => {
    if (!connectionString) throw new Error("unreachable");
    await withTestDatabase(connectionString, async (url) => {
      const owner = new Client({ connectionString: url });
      await owner.connect();
      try {
        await migrateUp(owner);
        // What `pg_restore --no-privileges` leaves: tables, policies, no grants.
        await owner.query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM brew_app");
        await owner.query("REVOKE USAGE ON SCHEMA app FROM brew_app");
        await ensureAppRole(owner, "brew-app-test-only");
        await owner.query(
          "INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/1', 'a@b.test', 'Ann')",
        );
        await owner.query(
          "INSERT INTO recipes (uri, owner_user_id, name, beverage) SELECT 'https://b.test/r/1', id, 'Pale', 'beer' FROM users",
        );

        const login = new URL(url);
        login.username = "brew_app";
        login.password = "brew-app-test-only";
        const app = new Client({ connectionString: login.href });
        await app.connect();
        try {
          const { rows } = await app.query(
            "SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user",
          );
          expect(rows).toEqual([{ bypass: false }]);
          // Private to Ann: invisible to an anonymous visitor, visible to Ann.
          expect((await app.query("SELECT 1 FROM recipes")).rowCount).toBe(0);
          await app.query(
            "SELECT set_config('app.user_id', (SELECT id::text FROM users LIMIT 1), false)",
          );
          expect((await app.query("SELECT 1 FROM recipes")).rowCount).toBe(1);
        } finally {
          await app.end();
        }
      } finally {
        await owner.end();
      }
    });
  });
});
