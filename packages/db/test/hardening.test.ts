// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-release hardening: finite inventory amounts, and equipment given back when its holder
// leaves the brewery.
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrateUp } from "../src/migrations.ts";
import { withTestDatabase } from "./test-database.ts";

const connectionString = process.env.TEST_DATABASE_URL;

async function withClient(run: (client: Client) => Promise<void>) {
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

const one = async (client: Client, sql: string, params: unknown[] = []) =>
  (await client.query<{ id: string }>(sql, params)).rows[0] as { id: string };

describe.skipIf(!connectionString)("hardening on Postgres (TEST_DATABASE_URL)", () => {
  it("rejects NaN and infinity in inventory amounts", async () => {
    await withClient(async (client) => {
      const ann = await one(
        client,
        "INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/1', 'a@b.test', 'Ann') RETURNING id",
      );
      const item = (quantity: string, threshold: string | null = null) =>
        client.query(
          "INSERT INTO inventory_items (uri, owner_user_id, name, quantity, quantity_unit, low_stock_threshold) VALUES ('https://b.test/i/' || uuidv7(), $1, 'Oats', $2::float8, 'kg', $3::float8) RETURNING id",
          [ann.id, quantity, threshold],
        );
      for (const bad of ["NaN", "Infinity"]) {
        await expect(item(bad), bad).rejects.toMatchObject({ code: "23514" });
        await expect(item("1", bad), bad).rejects.toMatchObject({ code: "23514" });
      }
      const oats = (await item("5", "1")).rows[0] as { id: string };

      const recipe = await one(
        client,
        "INSERT INTO recipes (uri, owner_user_id, name, beverage) VALUES ('https://b.test/r/1', $1, 'Pale', 'beer') RETURNING id",
        [ann.id],
      );
      const version = await one(
        client,
        "INSERT INTO recipe_versions (recipe_id, version, name, beverage, batch_size_l, content) VALUES ($1, 1, 'Pale', 'beer', 20, '{}') RETURNING id",
        [recipe.id],
      );
      const batch = await one(
        client,
        "INSERT INTO batches (uri, owner_user_id, recipe_version_id, name, beverage) VALUES ('https://b.test/x/1', $1, $2, 'Pale 1', 'beer') RETURNING id",
        [ann.id, version.id],
      );
      const reserve = (quantity: string) =>
        client.query(
          "INSERT INTO inventory_reservations (batch_id, inventory_item_id, quantity) VALUES ($1, $2, $3::float8)",
          [batch.id, oats.id, quantity],
        );
      for (const bad of ["NaN", "Infinity"]) {
        await expect(reserve(bad), bad).rejects.toMatchObject({ code: "23514" });
      }
      await reserve("4.5");
    });
  });

  it("gives equipment back when its holder leaves or is removed from the brewery", async () => {
    await withClient(async (client) => {
      const user = (n: number) =>
        one(
          client,
          `INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/${n}', 'u${n}@b.test', 'U${n}') RETURNING id`,
        );
      const [owner, holder] = [await user(1), await user(2)];
      const brewery = await one(
        client,
        "INSERT INTO breweries (uri, name) VALUES ('https://b.test/b/1', 'Hops Co') RETURNING id",
      );
      const other = await one(
        client,
        "INSERT INTO breweries (uri, name) VALUES ('https://b.test/b/2', 'Malt Co') RETURNING id",
      );
      for (const [b, u, role] of [
        [brewery.id, owner.id, "owner"],
        [brewery.id, holder.id, "member"],
        [other.id, holder.id, "member"],
      ]) {
        await client.query(
          "INSERT INTO memberships (brewery_id, user_id, role) VALUES ($1, $2, $3)",
          [b, u, role],
        );
      }
      const lend = (breweryId: string, name: string) =>
        one(
          client,
          "INSERT INTO equipment_items (uri, owner_brewery_id, name, held_by_user_id) VALUES ('https://b.test/e/' || uuidv7(), $1, $2, $3) RETURNING id",
          [breweryId, name, holder.id],
        );
      const kettle = await lend(brewery.id, "Kettle");
      const keg = await lend(other.id, "Keg");

      await client.query("DELETE FROM memberships WHERE brewery_id = $1 AND user_id = $2", [
        brewery.id,
        holder.id,
      ]);
      const held = await client.query<{ id: string; held_by_user_id: string | null }>(
        "SELECT id, held_by_user_id FROM equipment_items ORDER BY name",
      );
      // Only the brewery they left takes its kettle back; the other brewery's keg stays with them.
      expect(held.rows).toEqual([
        { id: keg.id, held_by_user_id: holder.id },
        { id: kettle.id, held_by_user_id: null },
      ]);
    });
  });
});
