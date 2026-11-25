// SPDX-License-Identifier: AGPL-3.0-or-later
// `pnpm db:migrate` applies pending migrations; `--rollback` undoes the latest one.
import { Client } from "pg";
import { APP_ROLE } from "./client.ts";
import { ensureAppRole, migrateUp, rollbackLatest } from "./migrations.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL in the root .env file or in the environment");
}

const client = new Client({ connectionString });
try {
  await client.connect();
  if (process.argv.includes("--rollback")) {
    const tag = await rollbackLatest(client);
    console.log(tag ? `Rolled back ${tag}` : "No migrations to roll back");
  } else {
    await migrateUp(client);
    // The server's own login (row-level security, ADR-0011), when it has one.
    // Compose leaves it empty when POSTGRES_APP_PASSWORD is unset.
    const app = process.env.APP_DATABASE_URL ? new URL(process.env.APP_DATABASE_URL) : undefined;
    if (app && decodeURIComponent(app.username) !== APP_ROLE) {
      throw new Error(`APP_DATABASE_URL must sign in as ${APP_ROLE}`);
    }
    await ensureAppRole(client, app ? decodeURIComponent(app.password) : undefined);
    console.log("Database migrations complete");
  }
} finally {
  await client.end();
}
