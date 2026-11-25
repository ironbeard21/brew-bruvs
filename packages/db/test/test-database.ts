// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from "node:crypto";
import { Client } from "pg";

export async function withTestDatabase<T>(
  connectionString: string,
  run: (databaseUrl: string) => Promise<T>,
): Promise<T> {
  const name = `brew_test_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(connectionString);
  databaseUrl.pathname = `/${name}`;

  const admin = new Client({ connectionString });
  const identifier = admin.escapeIdentifier(name);
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${identifier}`);
    try {
      return await run(databaseUrl.href);
    } finally {
      await admin.query(`DROP DATABASE ${identifier} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}

/** Rolls back newer migrations, then `tag` itself, so tests don't break when migrations are added. */
export async function rollbackThrough(client: Client, tag: string): Promise<void> {
  const { rollbackLatest } = await import("../src/migrations.ts");
  for (let rolled = await rollbackLatest(client); rolled !== tag; ) {
    if (!rolled) throw new Error(`Migration ${tag} was not applied`);
    rolled = await rollbackLatest(client);
  }
}
