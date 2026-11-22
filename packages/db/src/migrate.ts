// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL in the root .env file or in the environment");
}

const migrationsFolder = new URL("../drizzle/", import.meta.url);
const client = new Client({ connectionString });
try {
  await client.connect();
  if (existsSync(migrationsFolder)) {
    // The session releases the lock when the client closes, including after a failed migration.
    await client.query("SELECT pg_advisory_lock(hashtext($1))", ["brew-bruvs:drizzle-migrations"]);
    await migrate(drizzle(client), { migrationsFolder: fileURLToPath(migrationsFolder) });
    console.log("Database migrations complete");
  } else {
    await client.query("SELECT 1");
    console.log("Connected to Postgres. Schema migrations land in P0-08.");
  }
} finally {
  await client.end();
}
