// SPDX-License-Identifier: AGPL-3.0-or-later
// Connection pool + typed Drizzle client. pg connects lazily, on the first query.
//
// Row-level security (ADR-0011, migration 0008): every connection the pool hands out first sets
// `app.user_id` to the signed-in user of the current request (empty for anonymous visitors and
// for work outside a request), so policies see who is asking. With `role`, each new connection
// also switches to that role, for setups that connect as the owning role (development, tests).
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import * as schema from "./schema.ts";

/** The role the server runs as under row-level security. */
export const APP_ROLE = "brew_app";

const requestUser = new AsyncLocalStorage<string | null>();

/** Runs `work` with `userId` as the user every query in it acts for. */
export function asUser<T>(userId: string | null, work: () => T): T {
  return requestUser.run(userId, work);
}

export function createDb(connectionString: string, opts: { role?: string } = {}) {
  const pool = new Pool({ connectionString });
  const switched = new WeakSet<PoolClient>();
  const checkout = pool.connect.bind(pool);

  async function connect(): Promise<PoolClient> {
    // Read the user before waiting: a queued checkout can resume in another request's context.
    const userId = requestUser.getStore() ?? "";
    const client = await checkout();
    try {
      if (opts.role && !switched.has(client)) {
        await client.query(`SET ROLE ${client.escapeIdentifier(opts.role)}`);
        switched.add(client);
      }
      await client.query("SELECT set_config('app.user_id', $1, false)", [userId]);
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
    return client;
  }

  // Drizzle runs single queries through pool.query and transactions through pool.connect; both go
  // through `connect` above. The casts keep pg's overloads; only the promise forms are used.
  pool.connect = connect as typeof pool.connect;
  pool.query = (async (...args: Parameters<PoolClient["query"]>) => {
    const client = await connect();
    try {
      return await client.query(...args);
    } finally {
      client.release();
    }
  }) as typeof pool.query;

  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>["db"];

/** Tables whose rows row-level security protects (migration 0008). */
export const PROTECTED_TABLES = [
  "recipes",
  "recipe_versions",
  "batches",
  "batch_status_changes",
  "readings",
  "reminders",
  "notes",
  "inventory_items",
  "inventory_reservations",
  "equipment_items",
  "equipment_profiles",
  "shares",
  "integrations",
  "activity_events",
] as const;

/**
 * Refuses to run unless row-level security really applies: the connection acts as brew_app,
 * which isn't a superuser, can't bypass it and owns none of the protected tables (owners skip
 * policies), and every protected table has it turned on.
 */
export async function checkRowSecurity(db: Db) {
  const { rows } = await db.$client.query<{
    name: string;
    bypass: boolean;
    unprotected: string[];
  }>(
    `SELECT current_user AS name,
       (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
       ARRAY(SELECT t FROM unnest($1::text[]) AS t
         LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t)
         WHERE c.oid IS NULL OR NOT c.relrowsecurity OR pg_has_role(c.relowner, 'USAGE')
       ) AS unprotected`,
    [PROTECTED_TABLES],
  );
  const row = rows[0];
  const problem =
    row?.name !== APP_ROLE
      ? `runs as ${row?.name ?? "?"}, not ${APP_ROLE}`
      : row.bypass
        ? "can bypass row-level security"
        : row.unprotected.length
          ? `isn't held to row-level security on ${row.unprotected.join(", ")}`
          : null;
  if (problem) {
    throw new Error(
      `The server's database connection ${problem}. Connect as ${APP_ROLE} (APP_DATABASE_URL) and run the migrations.`,
    );
  }
}
