// SPDX-License-Identifier: AGPL-3.0-or-later
// Schema v3 (Phase 2): brewery roles, inventory and reservations, equipment, integrations, activity.
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { migrateUp } from "../src/migrations.ts";
import { rollbackThrough, withTestDatabase } from "./test-database.ts";

const connectionString = process.env.TEST_DATABASE_URL;
const violates = (code: string) => expect.objectContaining({ code });

async function withClient(run: (client: Client) => Promise<void>) {
  if (!connectionString) throw new Error("unreachable");
  await withTestDatabase(connectionString, async (url) => {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await run(client);
    } finally {
      await client.end();
    }
  });
}

async function one<T = { id: string }>(client: Client, sql: string, params: unknown[] = []) {
  const { rows } = await client.query(sql, params);
  return rows[0] as T;
}

const user = (client: Client, n: number) =>
  one(
    client,
    `INSERT INTO users (uri, email, display_name) VALUES ('https://b.test/u/${n}', 'u${n}@b.test', 'U${n}') RETURNING id`,
  );

describe.skipIf(!connectionString)("schema v3 on Postgres (TEST_DATABASE_URL)", () => {
  it("turns Phase 1 admins into owners, and members back into viewers on rollback", async () => {
    await withClient(async (client) => {
      await migrateUp(client);
      await rollbackThrough(client, "0006_schema_v3");
      const ann = await user(client, 1);
      const brewery = await one(
        client,
        "INSERT INTO breweries (uri, name) VALUES ('https://b.test/b/1', 'Hops Co') RETURNING id",
      );
      await client.query(
        "INSERT INTO memberships (brewery_id, user_id, role) VALUES ($1, $2, 'admin')",
        [brewery.id, ann.id],
      );

      await migrateUp(client);
      expect((await client.query("SELECT role FROM memberships")).rows).toEqual([
        { role: "owner" },
      ]);
      await client.query("UPDATE memberships SET role = 'member'");

      await rollbackThrough(client, "0006_schema_v3");
      expect((await client.query("SELECT role FROM memberships")).rows).toEqual([
        { role: "viewer" },
      ]);
      await migrateUp(client);
    });
  });

  it("enforces the inventory, reservation, equipment and integration rules", async () => {
    await withClient(async (client) => {
      await migrateUp(client);
      const ann = await user(client, 1);
      const brewery = await one(
        client,
        "INSERT INTO breweries (uri, name, description) VALUES ('https://b.test/b/1', 'Hops Co', 'Garage') RETURNING id",
      );
      const item = (columns: Record<string, unknown>) => {
        const names = Object.keys(columns);
        return one(
          client,
          `INSERT INTO inventory_items (uri, owner_user_id, name, quantity, quantity_unit${names.map((c) => `, ${c}`).join("")})
           VALUES ('https://b.test/i/' || uuidv7(), $1, 'Citra', 1, 'kg'${names.map((_, i) => `, $${i + 2}`).join("")})
           RETURNING id`,
          [ann.id, ...Object.values(columns)],
        );
      };
      const citra = await item({
        lot: "L42",
        location: "Freezer",
        alpha_acid_pct: 12.5,
        purchased_on: "2026-11-01",
        low_stock_threshold: 0.1,
        tradeable: true,
        tradeable_quantity: 0.5,
      });
      await expect(item({ alpha_acid_pct: 101 })).rejects.toEqual(violates("23514"));
      await expect(item({ low_stock_threshold: -1 })).rejects.toEqual(violates("23514"));
      await expect(item({ tradeable_quantity: 2 })).rejects.toEqual(violates("23514"));

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
        "INSERT INTO batches (uri, owner_brewery_id, recipe_version_id, name, beverage) VALUES ('https://b.test/x/1', $1, $2, 'Pale 1', 'beer') RETURNING id",
        [brewery.id, version.id],
      );
      const reserve = (quantity: number) =>
        client.query(
          "INSERT INTO inventory_reservations (batch_id, inventory_item_id, quantity) VALUES ($1, $2, $3)",
          [batch.id, citra.id, quantity],
        );
      await reserve(0.2);
      await expect(reserve(0)).rejects.toEqual(violates("23514"));
      expect((await client.query("SELECT state FROM inventory_reservations")).rows).toEqual([
        { state: "reserved" },
      ]);

      await client.query(
        "INSERT INTO equipment_items (uri, owner_brewery_id, name, type, condition, held_by_user_id) VALUES ('https://b.test/e/1', $1, 'Fermenter', 'fermenter', 'good', $2)",
        [brewery.id, ann.id],
      );
      await expect(
        client.query(
          "INSERT INTO equipment_items (uri, owner_user_id, name, condition) VALUES ('https://b.test/e/2', $1, 'Kettle', 'shiny')",
          [ann.id],
        ),
      ).rejects.toEqual(violates("22P02"));

      const integration = (kind: string, tokenHash: string | null, owners = [ann.id, null]) =>
        client.query(
          "INSERT INTO integrations (owner_user_id, owner_brewery_id, kind, name, token_hash, batch_id) VALUES ($1, $2, $3, 'Device', $4, $5)",
          [...owners, kind, tokenHash, batch.id],
        );
      await integration("ispindel", "hash-1");
      await integration("webhook_out", null);
      await expect(integration("tilt", null)).rejects.toEqual(violates("23514"));
      await expect(integration("rapt", "hash-2", [ann.id, brewery.id])).rejects.toEqual(
        violates("23514"),
      );
      await expect(integration("rapt", "hash-1")).rejects.toEqual(violates("23505"));

      await client.query(
        "INSERT INTO activity_events (brewery_id, actor_user_id, verb, object_type, object_id) VALUES ($1, $2, 'batch_started', 'batch', $3)",
        [brewery.id, ann.id, batch.id],
      );
      const profile = await one(
        client,
        "INSERT INTO equipment_profiles (uri, owner_user_id, name) VALUES ('https://b.test/p/1', $1, 'Kettle') RETURNING id",
        [ann.id],
      );
      await client.query(
        "INSERT INTO shares (resource_type, resource_id, to_brewery_id, level) VALUES ('equipment_profile', $1, $2, 'read')",
        [profile.id, brewery.id],
      );

      // Deleting the batch drops its reservations and unlinks its devices.
      await client.query("DELETE FROM batches WHERE id = $1", [batch.id]);
      expect((await client.query("SELECT 1 FROM inventory_reservations")).rowCount).toBe(0);
      expect((await client.query("SELECT batch_id FROM integrations")).rows).toEqual([
        { batch_id: null },
        { batch_id: null },
      ]);

      await rollbackThrough(client, "0006_schema_v3");
      expect((await client.query("SELECT 1 FROM shares")).rowCount).toBe(0);
      expect((await client.query("SELECT quantity FROM inventory_items")).rows).toEqual([
        { quantity: 1 },
      ]);
      await migrateUp(client);
    });
  });
});
