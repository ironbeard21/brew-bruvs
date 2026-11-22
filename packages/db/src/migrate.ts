// SPDX-License-Identifier: AGPL-3.0-or-later
// `pnpm db:migrate` applies pending migrations; `--rollback` undoes the latest one.
import { Client } from "pg";
import { migrateUp, rollbackLatest } from "./migrations.ts";

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
    console.log("Database migrations complete");
  }
} finally {
  await client.end();
}
