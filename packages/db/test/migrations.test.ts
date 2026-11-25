// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrateUp, rollbackLatest } from "../src/migrations.ts";
import { withTestDatabase } from "./test-database.ts";

const drizzleDir = new URL("../drizzle/", import.meta.url);
const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", drizzleDir), "utf8")) as {
  entries: { tag: string }[];
};

describe("down files", () => {
  it.each(journal.entries.map((e) => e.tag))("%s drops every table and type it creates", (tag) => {
    const up = readFileSync(new URL(`${tag}.sql`, drizzleDir), "utf8");
    const down = readFileSync(new URL(`down/${tag}.sql`, drizzleDir), "utf8");
    const names = (sql: string, re: RegExp) => [...sql.matchAll(re)].map((m) => m[1]).sort();
    expect(names(down, /DROP TABLE "(\w+)"/g)).toEqual(names(up, /CREATE TABLE "(\w+)"/g));
    expect(names(down, /DROP TYPE "public"\."(\w+)"/g)).toEqual(
      names(up, /CREATE TYPE "public"\."(\w+)"/g),
    );
    const pairs = (sql: string, re: RegExp) =>
      [...sql.matchAll(re)].map((m) => `${m[1]}.${m[2]}`).sort();
    expect(pairs(down, /ALTER TABLE "(\w+)" DROP COLUMN "(\w+)"/g)).toEqual(
      pairs(up, /ALTER TABLE "(\w+)" ADD COLUMN "(\w+)"/g),
    );
  });
});

const connectionString = process.env.TEST_DATABASE_URL;

async function withMigratedDb(run: (client: Client) => Promise<void>) {
  if (!connectionString) throw new Error("unreachable");
  await withTestDatabase(connectionString, async (url) => {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await migrateUp(client);
      await run(client);
    } finally {
      await client.end();
    }
  });
}

const tables = async (client: Client) =>
  (
    await client.query<{ t: string }>(
      "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
    )
  ).rows.map((r) => r.t);

describe.skipIf(!connectionString)("schema on Postgres (TEST_DATABASE_URL)", () => {
  it("applies to an empty database, rolls back to empty, and re-applies", async () => {
    await withMigratedDb(async (client) => {
      expect(await tables(client)).toHaveLength(28);

      const rolledBack: string[] = [];
      for (let tag = await rollbackLatest(client); tag; tag = await rollbackLatest(client)) {
        rolledBack.push(tag);
      }
      expect(rolledBack).toEqual(journal.entries.map((e) => e.tag).reverse());
      expect(await tables(client)).toEqual([]);
      const types = await client.query(
        "SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e'",
      );
      expect(types.rowCount).toBe(0);
      expect(await rollbackLatest(client)).toBeNull();

      await migrateUp(client);
      expect(await tables(client)).toHaveLength(28);
    });
  });

  it("enforces ids, owners, shares and unique emails", async () => {
    await withMigratedDb(async (client) => {
      const user = await client.query<{ id: string }>(
        "INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/1', 'Ann@Example.com', 'Ann') RETURNING id",
      );
      const userId = user.rows[0]?.id ?? "";
      expect(userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // UUIDv7

      await expect(
        client.query(
          "INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/2', 'ann@example.com', 'Ann 2')",
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const brewery = await client.query<{ id: string }>(
        "INSERT INTO breweries (uri, name) VALUES ('https://b.test/b/1', 'Hops Co') RETURNING id",
      );
      const breweryId = brewery.rows[0]?.id ?? "";

      const recipe = (uri: string, ownerUser: string | null, ownerBrewery: string | null) =>
        client.query<{ id: string }>(
          "INSERT INTO recipes (uri, owner_user_id, owner_brewery_id, name, beverage) VALUES ($1, $2, $3, 'Pale', 'beer') RETURNING id",
          [uri, ownerUser, ownerBrewery],
        );
      const recipeId = (await recipe("https://b.test/r/1", userId, null)).rows[0]?.id;
      await recipe("https://b.test/r/2", null, breweryId);
      // Exactly one owner: neither and both are rejected.
      await expect(recipe("https://b.test/r/3", null, null)).rejects.toMatchObject({
        code: "23514",
      });
      await expect(recipe("https://b.test/r/4", userId, breweryId)).rejects.toMatchObject({
        code: "23514",
      });

      const share = (level: string) =>
        client.query(
          "INSERT INTO shares (resource_type, resource_id, to_brewery_id, level) VALUES ('recipe', $1, $2, $3)",
          [recipeId, breweryId, level],
        );
      await share("read");
      // One share per resource and target.
      await expect(share("edit")).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("keeps catalog seed ids and finds items by alias", async () => {
    await withMigratedDb(async (client) => {
      await client.query(
        "INSERT INTO hops (id, name, aliases, sources, licenses, beverages) VALUES ('hop-columbus', 'Columbus', '{CTZ,Zeus}', '{bt003}', '{GPL-3.0}', '{beer}')",
      );
      const { rows } = await client.query("SELECT id FROM hops WHERE aliases @> ARRAY['Zeus']");
      expect(rows).toEqual([{ id: "hop-columbus" }]);
    });
  });
});
