// SPDX-License-Identifier: AGPL-3.0-or-later
import { Client } from "pg";
import { expect, test } from "vitest";
import { withTestDatabase } from "./test-database.ts";

const connectionString = process.env.TEST_DATABASE_URL;

test("uses separate empty databases and drops them after success or failure", async (context) => {
  if (!connectionString) {
    context.skip("Set TEST_DATABASE_URL to run Postgres integration tests");
    return;
  }

  const urls: string[] = [];
  const failure = new Error("test callback failed");
  const results = await Promise.allSettled([
    withTestDatabase(connectionString, async (url) => {
      urls.push(url);
      const client = new Client({ connectionString: url });
      try {
        await client.connect();
        const { rows } = await client.query("SELECT current_database() AS name");
        expect(rows).toEqual([{ name: new URL(url).pathname.slice(1) }]);
        await client.query("CREATE TABLE isolation_check (id integer)");
      } finally {
        await client.end();
      }
    }),
    withTestDatabase(connectionString, async (url) => {
      urls.push(url);
      const client = new Client({ connectionString: url });
      try {
        await client.connect();
        const { rows } = await client.query("SELECT to_regclass('isolation_check') AS table_name");
        expect(rows).toEqual([{ table_name: null }]);
      } finally {
        await client.end();
      }
      throw failure;
    }),
  ]);

  expect(results).toEqual([
    { status: "fulfilled", value: undefined },
    { status: "rejected", reason: failure },
  ]);
  expect(new Set(urls).size).toBe(2);
  for (const url of urls) {
    const client = new Client({ connectionString: url });
    try {
      await expect(client.connect()).rejects.toMatchObject({ code: "3D000" });
    } finally {
      await client.end();
    }
  }
});
