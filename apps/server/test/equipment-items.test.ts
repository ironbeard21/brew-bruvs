// SPDX-License-Identifier: AGPL-3.0-or-later
import { importCatalog } from "@brew-bruvs/catalog-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { call, TEST_DATABASE_URL, twoUsers, withApp } from "./helpers.ts";

const path = "/api/equipment";

describe.skipIf(!TEST_DATABASE_URL)("equipment API on PostgreSQL", () => {
  it("reads an item by ID with an owner or read share", async () => {
    await withApp({}, async (app, sql) => {
      const { adminToken, annToken, annId } = await twoUsers(app);
      const created = await call(app, "POST", path, {
        token: adminToken,
        body: { name: "Keg" },
      });
      expect(created.status).toBe(201);
      const item = `${path}/${created.json.id}`;

      expect((await call(app, "GET", item)).status).toBe(401);
      expect((await call(app, "GET", `${path}/bad-id`, { token: adminToken })).status).toBe(400);
      expect((await call(app, "GET", item, { token: annToken })).status).toBe(404);
      const owned = await call(app, "GET", item, { token: adminToken });
      expect(owned.status).toBe(200);
      expect(owned.json).toEqual({
        ...created.json,
        can: { contribute: true, edit: true, delete: true, share: true },
      });

      await sql.query(
        "INSERT INTO shares (resource_type, resource_id, to_user_id, level) VALUES ('equipment_item', $1, $2, 'read')",
        [created.json.id, annId],
      );
      const shared = await call(app, "GET", item, { token: annToken });
      expect(shared.status).toBe(200);
      expect(shared.json).toEqual({
        ...created.json,
        can: { contribute: false, edit: false, delete: false, share: false },
      });
      expect((await call(app, "DELETE", item, { token: annToken })).status).toBe(403);
    });
  }, 15_000);

  it("creates from the catalog, pages and edits personal items, and deletes them", async () => {
    await withApp({}, async (app, sql) => {
      const { adminToken, annToken, annId } = await twoUsers(app);
      await importCatalog(drizzle(sql));
      const [catalog] = (
        await sql.query(
          "SELECT id, name, category, batch_size_l FROM equipment WHERE batch_size_l IS NOT NULL ORDER BY id LIMIT 1",
        )
      ).rows;
      const create = (body: unknown, token = adminToken) =>
        call(app, "POST", path, { token, body });

      expect((await call(app, "POST", path, { body: { name: "Kettle" } })).status).toBe(401);
      expect((await create({})).status).toBe(400);
      expect((await create({ catalogId: "missing" })).json.error?.code).toBe("unknown_catalog_id");
      const created = await create({ catalogId: catalog.id, condition: "good" });
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        name: catalog.name,
        type: catalog.category,
        catalogId: catalog.id,
        batchSizeL: catalog.batch_size_l,
        condition: "good",
        visibility: "private",
        heldByUserId: null,
        owner: { type: "user" },
      });

      expect((await create({ name: "Fermentation bucket" })).status).toBe(201);
      const first = await call(app, "GET", `${path}?limit=1`, { token: adminToken });
      expect(first.status).toBe(200);
      expect(first.json).toMatchObject({ items: [expect.anything()], nextOffset: 1 });
      const second = await call(app, "GET", `${path}?limit=1&offset=1`, { token: adminToken });
      expect(second.json).toMatchObject({ items: [expect.anything()], nextOffset: null });
      expect(second.json.items).not.toEqual(first.json.items);
      expect((await call(app, "GET", path, { token: annToken })).json.items).toEqual([]);
      expect((await call(app, "GET", path)).status).toBe(401);
      expect((await call(app, "GET", `${path}?limit=0`, { token: adminToken })).status).toBe(400);

      const item = `${path}/${created.json.id}`;
      const patch = (body: unknown, token = adminToken) =>
        call(app, "PATCH", item, { token, body });
      expect((await patch({ batchSizeL: -1 })).status).toBe(400);
      expect((await patch({ name: "Other person's kettle" }, annToken)).status).toBe(404);
      const updated = await patch({ name: "Kettle", type: null, batchSizeL: 30, notes: "Spare" });
      expect(updated.status).toBe(200);
      expect(updated.json).toMatchObject({
        name: "Kettle",
        type: null,
        batchSizeL: 30,
        notes: "Spare",
      });
      expect((await call(app, "DELETE", `${path}/bad-id`, { token: adminToken })).status).toBe(400);
      expect((await call(app, "DELETE", item, { token: annToken })).status).toBe(404);
      await sql.query(
        "INSERT INTO shares (resource_type, resource_id, to_user_id, level) VALUES ('equipment_item', $1, $2, 'read'), ('recipe', $1, $2, 'read')",
        [created.json.id, annId],
      );
      expect((await call(app, "DELETE", item, { token: adminToken })).status).toBe(204);
      const remaining = await sql.query("SELECT resource_type FROM shares WHERE resource_id = $1", [
        created.json.id,
      ]);
      expect(remaining.rows).toEqual([{ resource_type: "recipe" }]);
      expect((await patch({ name: "Gone" })).status).toBe(404);
    });
  }, 15_000);

  it("restricts brewery writes and logs each actual loan or return with the holder update", async () => {
    await withApp({}, async (app, sql) => {
      const { adminToken, annToken, annId } = await twoUsers(app);
      const admin = await call(app, "GET", "/api/me", { token: adminToken });
      const [{ id: breweryId }] = (
        await sql.query(
          "INSERT INTO breweries (uri, name) VALUES ('https://brew.test/brewery/test', 'Test brewery') RETURNING id",
        )
      ).rows;
      await sql.query(
        "INSERT INTO memberships (brewery_id, user_id, role) VALUES ($1, $2, 'owner')",
        [breweryId, admin.json.id],
      );

      const create = (token: string) =>
        call(app, "POST", path, {
          token,
          body: { name: "Brewery keg", breweryId },
        });
      expect((await create(annToken)).status).toBe(404);
      expect(
        (await call(app, "GET", `${path}?breweryId=${breweryId}`, { token: annToken })).status,
      ).toBe(404);
      const created = await create(adminToken);
      expect(created.status).toBe(201);
      expect(created.json.owner).toEqual({ type: "brewery", id: breweryId });

      const item = `${path}/${created.json.id}`;
      const holder = (body: unknown, token = adminToken) =>
        call(app, "PUT", `${item}/holder`, { token, body });
      expect((await holder({ heldByUserId: annId })).json.error?.code).toBe(
        "unknown_brewery_member",
      );
      expect((await holder({ heldByUserId: "invalid" })).status).toBe(400);
      await sql.query(
        "INSERT INTO memberships (brewery_id, user_id, role) VALUES ($1, $2, 'member')",
        [breweryId, annId],
      );
      expect(
        (await call(app, "GET", `${path}?breweryId=${breweryId}`, { token: annToken })).json.items,
      ).toMatchObject([{ id: created.json.id }]);
      expect((await create(annToken)).status).toBe(403);
      expect(
        (await call(app, "PATCH", item, { token: annToken, body: { name: "No" } })).status,
      ).toBe(403);
      expect((await call(app, "DELETE", item, { token: annToken })).status).toBe(403);
      expect((await holder({ heldByUserId: annId }, annToken)).status).toBe(403);

      const personal = await call(app, "POST", path, {
        token: adminToken,
        body: { name: "Spare keg" },
      });
      const personalLoan = await call(app, "PUT", `${path}/${personal.json.id}/holder`, {
        token: adminToken,
        body: { heldByUserId: annId },
      });
      expect(personalLoan.json.error?.code).toBe("brewery_equipment_required");

      const loans = await Promise.all([
        holder({ heldByUserId: annId }),
        holder({ heldByUserId: annId }),
      ]);
      for (const loan of loans) {
        expect(loan.status).toBe(200);
        expect(loan.json.heldByUserId).toBe(annId);
      }
      const returned = await holder({ heldByUserId: null });
      expect(returned.status).toBe(200);
      expect(returned.json.heldByUserId).toBeNull();

      const history = await sql.query(
        "SELECT actor_user_id, verb, object_type, object_id FROM activity_events WHERE brewery_id = $1 ORDER BY at, id",
        [breweryId],
      );
      expect(history.rows).toEqual(
        ["item_lent", "item_returned"].map((verb) => ({
          actor_user_id: admin.json.id,
          verb,
          object_type: "equipment_item",
          object_id: created.json.id,
        })),
      );

      await sql.query(
        "UPDATE memberships SET role = 'brewer' WHERE brewery_id = $1 AND user_id = $2",
        [breweryId, annId],
      );
      expect((await create(annToken)).status).toBe(201);
      const updated = await call(app, "PATCH", item, {
        token: annToken,
        body: { name: "Clean keg" },
      });
      expect(updated.status).toBe(200);
      expect(updated.json.name).toBe("Clean keg");
      const brewerLoan = await holder({ heldByUserId: admin.json.id }, annToken);
      expect(brewerLoan.status).toBe(200);
      expect(brewerLoan.json.heldByUserId).toBe(admin.json.id);
      expect((await call(app, "DELETE", item, { token: annToken })).status).toBe(403);
    });
  }, 15_000);
});
