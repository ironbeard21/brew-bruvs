// SPDX-License-Identifier: AGPL-3.0-or-later
// Schema v2 rules the database enforces itself: permanent recipe credit, immutable recipe
// versions, batch statuses per beverage, and the 'unlisted' visibility surviving a rollback.
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrateUp, rollbackLatest } from "../src/migrations.ts";
import { withTestDatabase } from "./test-database.ts";

const connectionString = process.env.TEST_DATABASE_URL;

async function withDb(run: (client: Client, userId: string) => Promise<void>) {
  if (!connectionString) throw new Error("unreachable");
  await withTestDatabase(connectionString, async (url) => {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await migrateUp(client);
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/1', 'a@b.test', 'Ann') RETURNING id",
      );
      await run(client, rows[0]?.id ?? "");
    } finally {
      await client.end();
    }
  });
}

const one = async <T>(client: Client, sql: string, params: unknown[] = []) =>
  (await client.query(sql, params)).rows[0] as T;

async function recipe(client: Client, userId: string, extra = "", values: unknown[] = []) {
  const cols = extra ? `, ${extra}` : "";
  const marks = values.map((_, i) => `, $${i + 2}`).join("");
  return (
    await one<{ id: string }>(
      client,
      `INSERT INTO recipes (uri, owner_user_id, name, beverage${cols})
       VALUES ('https://b.test/r/' || uuidv7(), $1, 'Pale', 'beer'${marks}) RETURNING id`,
      [userId, ...values],
    )
  ).id;
}

async function version(client: Client, recipeId: string, extra = "", values: unknown[] = []) {
  const cols = extra ? `, ${extra}` : "";
  const marks = values.map((_, i) => `, $${i + 2}`).join("");
  return (
    await one<{ id: string }>(
      client,
      `INSERT INTO recipe_versions (recipe_id, version, name, beverage, batch_size_l, content${cols})
       VALUES ($1, 1, 'Pale', 'beer', 20, '{}'${marks}) RETURNING id`,
      [recipeId, ...values],
    )
  ).id;
}

describe.skipIf(!connectionString)("schema v2 on Postgres (TEST_DATABASE_URL)", () => {
  it("keeps recipe credit once set, but lets it be added", async () => {
    await withDb(async (client, userId) => {
      const imported = await recipe(
        client,
        userId,
        "credit_source_url, credit_site, credit_author, credit_imported_at, credit_license",
        ["https://site.test/pale", "Site", "Bo", "2026-11-22T00:00:00Z", "CC-BY-4.0"],
      );
      for (const col of [
        "credit_source_url",
        "credit_site",
        "credit_author",
        "credit_imported_at",
        "credit_license",
      ]) {
        await expect(
          client.query(`UPDATE recipes SET ${col} = NULL WHERE id = $1`, [imported]),
        ).rejects.toMatchObject({ code: "BB001" });
      }
      await expect(
        client.query("UPDATE recipes SET credit_author = 'Someone else' WHERE id = $1", [imported]),
      ).rejects.toMatchObject({ code: "BB001" });
      // Other columns still change freely.
      await client.query("UPDATE recipes SET name = 'Hoppy Pale' WHERE id = $1", [imported]);

      const forked = await recipe(client, userId, "forked_from_uri, forked_from_recipe_id", [
        "https://b.test/r/original",
        imported,
      ]);
      await expect(
        client.query("UPDATE recipes SET forked_from_uri = NULL WHERE id = $1", [forked]),
      ).rejects.toMatchObject({ code: "BB001" });
      // Deleting the original only clears the local link; the URI credit stays.
      await client.query("DELETE FROM recipes WHERE id = $1", [imported]);
      expect(
        await one(
          client,
          "SELECT forked_from_uri, forked_from_recipe_id FROM recipes WHERE id = $1",
          [forked],
        ),
      ).toEqual({ forked_from_uri: "https://b.test/r/original", forked_from_recipe_id: null });

      const own = await recipe(client, userId);
      await client.query("UPDATE recipes SET credit_site = 'Later' WHERE id = $1", [own]);
    });
  });

  it("never changes a recipe version except a deleted reference going null", async () => {
    await withDb(async (client, userId) => {
      await client.query(
        "INSERT INTO styles (id, name, sources, licenses, style_guide, beverage) VALUES ('style-x', 'X', '{s}', '{MIT}', 'BJCP', 'beer')",
      );
      const profile = (
        await one<{ id: string }>(
          client,
          "INSERT INTO equipment_profiles (uri, owner_user_id, name, efficiency_pct) VALUES ('https://b.test/e/1', $1, 'Kettle', 72) RETURNING id",
          [userId],
        )
      ).id;
      const recipeId = await recipe(client, userId);
      const versionId = await version(client, recipeId, "style_id, equipment_profile_id", [
        "style-x",
        profile,
      ]);

      for (const change of [
        "name = 'Changed'",
        "content = '{\"hops\": []}'",
        "batch_size_l = 19",
        "style_id = NULL",
        "equipment_profile_id = NULL",
        "created_by_user_id = NULL, name = 'Sneaky'",
      ]) {
        await expect(
          client.query(`UPDATE recipe_versions SET ${change} WHERE id = $1`, [versionId]),
        ).rejects.toMatchObject({ code: "BB002" });
      }
      // Pointing a reference somewhere else is a change too.
      await client.query(
        "INSERT INTO styles (id, name, sources, licenses, style_guide, beverage) VALUES ('style-y', 'Y', '{s}', '{MIT}', 'BJCP', 'beer')",
      );
      await expect(
        client.query("UPDATE recipe_versions SET style_id = 'style-y' WHERE id = $1", [versionId]),
      ).rejects.toMatchObject({ code: "BB002" });
      expect(
        await one(client, "SELECT style_id FROM recipe_versions WHERE id = $1", [versionId]),
      ).toEqual({ style_id: "style-x" });

      // Deleting what a version points at is allowed; the reference goes null.
      await client.query("DELETE FROM styles WHERE id = 'style-x'");
      await client.query("DELETE FROM equipment_profiles WHERE id = $1", [profile]);
      expect(
        await one(
          client,
          "SELECT style_id, equipment_profile_id, name FROM recipe_versions WHERE id = $1",
          [versionId],
        ),
      ).toEqual({ style_id: null, equipment_profile_id: null, name: "Pale" });

      // Deleting a recipe still removes its versions.
      await client.query("DELETE FROM recipes WHERE id = $1", [recipeId]);
      expect(
        (await client.query("SELECT 1 FROM recipe_versions WHERE id = $1", [versionId])).rowCount,
      ).toBe(0);
    });
  });

  it("limits each beverage to its own statuses and records readings and reminders", async () => {
    await withDb(async (client, userId) => {
      const versionId = await version(client, await recipe(client, userId));
      const batch = (beverage: string, status: string) =>
        client.query<{ id: string }>(
          `INSERT INTO batches (uri, owner_user_id, recipe_version_id, name, beverage, status)
           VALUES ('https://b.test/b/' || uuidv7(), $1, $2, 'B', $3, $4) RETURNING id`,
          [userId, versionId, beverage, status],
        );
      await batch("beer", "fermenting");
      await batch("mead", "bulk_aging");
      await batch("wine", "finished");
      await expect(batch("beer", "bulk_aging")).rejects.toMatchObject({ code: "23514" });
      await expect(batch("cider", "conditioning")).rejects.toMatchObject({ code: "23514" });

      const mead = (await batch("mead", "planned")).rows[0]?.id;
      await client.query(
        "INSERT INTO batch_status_changes (batch_id, status, changed_by_user_id) VALUES ($1, 'primary', $2)",
        [mead, userId],
      );
      const reading = await one(
        client,
        "INSERT INTO readings (batch_id, taken_at, brix, titratable_acidity_g_per_l, free_so2_mg_per_l) VALUES ($1, now(), 24.5, 6.5, 30) RETURNING source",
        [mead],
      );
      expect(reading).toEqual({ source: "manual" });
      await client.query(
        "INSERT INTO reminders (batch_id, kind, due_at) VALUES ($1, 'nutrient', now() + interval '1 day')",
        [mead],
      );
      await expect(
        client.query("INSERT INTO reminders (batch_id, kind, due_at) VALUES ($1, 'party', now())", [
          mead,
        ]),
      ).rejects.toMatchObject({ code: "22P02" });

      // Deleting the batch removes its history, readings and reminders.
      await client.query("DELETE FROM batches WHERE id = $1", [mead]);
      for (const table of ["batch_status_changes", "readings", "reminders"]) {
        expect((await client.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
      }
    });
  });

  it("defaults users to US units and keeps efficiency in range", async () => {
    await withDb(async (client, userId) => {
      expect(await one(client, "SELECT units FROM users WHERE id = $1", [userId])).toEqual({
        units: "us",
      });
      await expect(
        client.query(
          "INSERT INTO equipment_profiles (uri, owner_user_id, name, efficiency_pct) VALUES ('https://b.test/e/2', $1, 'Bad', 120)",
          [userId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("turns unlisted items private when schema v2 is rolled back", async () => {
    await withDb(async (client, userId) => {
      const unlisted = await recipe(client, userId, "visibility", ["unlisted"]);
      const server = await recipe(client, userId, "visibility", ["server"]);
      expect(await rollbackLatest(client)).toBe("0003_recipe_guards");
      expect(await rollbackLatest(client)).toBe("0002_schema_v2");
      const { rows } = await client.query<{ id: string; visibility: string }>(
        "SELECT id, visibility FROM recipes",
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.visibility]))).toEqual({
        [unlisted]: "private",
        [server]: "server",
      });
      // The default survives the rebuilt type, and v2 applies again on top.
      await recipe(client, userId);
      await migrateUp(client);
      await recipe(client, userId, "visibility", ["unlisted"]);
    });
  });
});
