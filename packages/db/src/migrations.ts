// SPDX-License-Identifier: AGPL-3.0-or-later
// Applies Drizzle migrations, and rolls back the latest one using its hand-written down file
// in drizzle/down/<tag>.sql.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Client } from "pg";

const migrationsFolder = fileURLToPath(new URL("../drizzle/", import.meta.url));
const LOCK = "brew-bruvs:drizzle-migrations";

// The session releases the lock when the client closes, including after a failure.
async function lock(client: Client) {
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [LOCK]);
}

export async function migrateUp(client: Client): Promise<void> {
  await lock(client);
  await migrate(drizzle(client), { migrationsFolder });
}

/** Rolls back the latest applied migration. Returns its tag, or null if none is applied. */
export async function rollbackLatest(client: Client): Promise<string | null> {
  await lock(client);
  const { rows } = await client
    .query<{ created_at: string }>(
      `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
    )
    .catch((err: { code?: string }) => {
      if (err.code === "42P01") return { rows: [] }; // migrations table doesn't exist yet
      throw err;
    });
  const latest = rows[0];
  if (!latest) return null;

  const journal = JSON.parse(readFileSync(`${migrationsFolder}meta/_journal.json`, "utf8")) as {
    entries: { when: number; tag: string }[];
  };
  const entry = journal.entries.find((e) => e.when === Number(latest.created_at));
  if (!entry) throw new Error(`No journal entry for applied migration at ${latest.created_at}`);
  const down = readFileSync(`${migrationsFolder}down/${entry.tag}.sql`, "utf8");

  await client.query("BEGIN");
  try {
    await client.query(down);
    await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [
      latest.created_at,
    ]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  return entry.tag;
}

/**
 * Makes sure the server's role (brew_app) exists with its grants, which a restore made with
 * `pg_restore --no-privileges` into a fresh cluster leaves out. With `password`, the role can
 * log in with it (APP_DATABASE_URL). Runs at every start, after the migrations.
 */
export async function ensureAppRole(client: Client, password?: string): Promise<void> {
  await client.query(`
    DO $$ BEGIN
      CREATE ROLE brew_app NOLOGIN;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
    END $$;
    DO $$ BEGIN
      IF NOT pg_has_role(current_user, 'brew_app', 'MEMBER') THEN
        EXECUTE format('GRANT brew_app TO %I', current_user);
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public, app TO brew_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO brew_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brew_app;
  `);
  if (password !== undefined) {
    await client.query(`ALTER ROLE brew_app WITH LOGIN PASSWORD ${client.escapeLiteral(password)}`);
  }
}
