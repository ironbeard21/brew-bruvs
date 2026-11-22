// SPDX-License-Identifier: AGPL-3.0-or-later
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { importCatalog } from "./catalog.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL in the root .env file or the environment");

const client = new Client({ connectionString });
try {
  await client.connect();
  const changed = await importCatalog(drizzle(client));
  console.log(`Catalog seeded (${changed} rows inserted or updated).`);
} finally {
  await client.end();
}
