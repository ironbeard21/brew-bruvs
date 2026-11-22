// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from "node:fs/promises";
import { migrateUp } from "@brew-bruvs/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { expect, test } from "vitest";
import { withTestDatabase } from "../../db/test/test-database.ts";
import { findCatalogMatches, importCatalog } from "../src/index.ts";

const connectionString = process.env.TEST_DATABASE_URL;

test("loads the catalog, preserves credit and finds aliases without rewriting unchanged rows", async (context) => {
  if (!connectionString) {
    context.skip("Set TEST_DATABASE_URL to run Postgres integration tests");
    return;
  }

  await withTestDatabase(connectionString, async (url) => {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await migrateUp(client);
      const db = drizzle(client);
      const report = await readFile(new URL("../data/build_report.csv", import.meta.url), "utf8");
      const counts = Object.fromEntries(
        report
          .trim()
          .split(/\r?\n/)
          .slice(1)
          .map((line) => {
            const [table, , merged] = line.split(",");
            return [table, Number(merged)];
          }),
      );
      expect(await importCatalog(db)).toBe(
        Object.values(counts).reduce((sum, count) => sum + count, 0),
      );

      for (const [table, count] of Object.entries(counts)) {
        const { rows } = await client.query(
          `SELECT count(*)::int AS count FROM ${client.escapeIdentifier(table)}`,
        );
        expect(rows).toEqual([{ count }]);
      }

      const hops = await client.query(
        "SELECT id, alpha_acid_pct, aliases, sources, licenses FROM hops WHERE id IN ('hop-citra', 'hop-columbus') ORDER BY id",
      );
      expect(hops.rows).toEqual([
        expect.objectContaining({
          id: "hop-citra",
          alpha_acid_pct: 12.5,
          sources: ["bt003", "bt005ba", "beerproto", "wallbrew", "bt001"],
          licenses: ["CC-BY-SA-4.0", "GPL-3.0", "MIT"],
        }),
        expect.objectContaining({
          id: "hop-columbus",
          alpha_acid_pct: 16,
          aliases: expect.arrayContaining(["CTZ", "Zeus"]),
        }),
      ]);
      expect(await findCatalogMatches(db, "hops", " zeus ")).toContainEqual({
        id: "hop-columbus",
        name: "Columbus",
      });
      expect(await findCatalogMatches(db, "hops", "Citra")).toContainEqual({
        id: "hop-citra",
        name: "Citra",
      });
      expect(await findCatalogMatches(db, "hops", "%")).toEqual([]);

      const yeasts = await client.query(
        "SELECT id, product_id, temp_min_c, alcohol_tolerance_pct FROM yeasts WHERE id IN ('yeast-white-labs-wlp001', 'yeast-lallemand-lalvin-ec-1118') ORDER BY id",
      );
      expect(yeasts.rows).toEqual([
        expect.objectContaining({
          product_id: "LALVIN-EC-1118",
          temp_min_c: 10,
          alcohol_tolerance_pct: 18,
        }),
        expect.objectContaining({ product_id: "WLP001", temp_min_c: 20 }),
      ]);
      const style = await client.query(
        "SELECT style_id, og_min, color_ebc_min, notes FROM styles WHERE id = 'style-bjcp-2021-21a'",
      );
      expect(style.rows).toEqual([
        { style_id: "21A", og_min: 1.056, color_ebc_min: 11.82, notes: null },
      ]);
      const honey = await client.query(
        "SELECT potential_sg FROM fermentables WHERE id = 'ferm-alfalfa-honey'",
      );
      expect(honey.rows).toEqual([{ potential_sg: 1.035 }]);

      await client.query(
        "INSERT INTO hops (id, name, sources, licenses) VALUES ('community-hop', 'Community Hop', ARRAY['community'], ARRAY['CC0-1.0'])",
      );
      expect(await importCatalog(db)).toBe(0);
      await client.query("UPDATE hops SET alpha_acid_pct = NULL WHERE id = 'hop-citra'");
      expect(await importCatalog(db)).toBe(1);
      expect(
        (await client.query("SELECT alpha_acid_pct FROM hops WHERE id = 'hop-citra'")).rows,
      ).toEqual([{ alpha_acid_pct: 12.5 }]);
      expect(await findCatalogMatches(db, "hops", "Community Hop")).toEqual([
        { id: "community-hop", name: "Community Hop" },
      ]);
    } finally {
      await client.end();
    }
  });
}, 15_000);
