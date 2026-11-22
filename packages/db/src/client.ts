// SPDX-License-Identifier: AGPL-3.0-or-later
// Connection pool + typed Drizzle client. pg connects lazily, on the first query.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
