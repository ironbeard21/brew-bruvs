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
