// SPDX-License-Identifier: AGPL-3.0-or-later
// Tasting notes: BJCP scores only on tasting notes, within the score sheet's maximums.
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrateUp, rollbackLatest } from "../src/migrations.ts";
import { withTestDatabase } from "./test-database.ts";

const connectionString = process.env.TEST_DATABASE_URL;

describe.skipIf(!connectionString)("tasting notes on Postgres (TEST_DATABASE_URL)", () => {
  it("keeps scores on tasting notes, in range, and rolls back to plain notes", async () => {
    if (!connectionString) throw new Error("unreachable");
    await withTestDatabase(connectionString, async (url) => {
      const client = new Client({ connectionString: url });
      try {
        await client.connect();
        await migrateUp(client);
        const { rows } = await client.query<{ id: string }>(
          "INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/1', 'a@b.test', 'Ann') RETURNING id",
        );
        const note = (kind: string, scores: string[] = [], values: number[] = []) =>
          client.query(
            `INSERT INTO notes (uri, owner_user_id, kind, body${scores.map((c) => `, ${c}`).join("")})
             VALUES ('https://b.test/n/' || uuidv7(), $1, $2, 'Lovely'${values.map((_, i) => `, $${i + 3}`).join("")})`,
            [rows[0]?.id, kind, ...values],
          );
        const all = ["aroma", "appearance", "flavor", "mouthfeel", "overall"].map(
          (k) => `score_${k}`,
        );

        await note("tasting", all, [12, 3, 20, 5, 10]);
        await note("tasting", ["score_flavor"], [0]);
        await note("tasting");
        await note("general");
        await expect(note("general", ["score_overall"], [8])).rejects.toMatchObject({
          code: "23514",
        });
        await expect(note("tasting", ["score_aroma"], [13])).rejects.toMatchObject({
          code: "23514",
        });
        await expect(note("tasting", ["score_appearance"], [-1])).rejects.toMatchObject({
          code: "23514",
        });

        expect(await rollbackLatest(client)).toBe("0006_schema_v3");
        expect(await rollbackLatest(client)).toBe("0005_tasting_notes");
        expect((await client.query("SELECT body FROM notes")).rowCount).toBe(4);
        await migrateUp(client);
        expect((await client.query("SELECT DISTINCT kind FROM notes")).rows).toEqual([
          { kind: "general" },
        ]);
      } finally {
        await client.end();
      }
    });
  });
});
