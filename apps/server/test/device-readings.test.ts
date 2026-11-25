// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { hashSecret } from "../src/auth/secrets.ts";
import { deviceBody, parseDeviceReading } from "../src/integrations/device-payload.ts";
import { call, offlineDeps, TEST_DATABASE_URL, twoUsers, withApp } from "./helpers.ts";

const read = (name: string) =>
  readFileSync(new URL(`./fixtures/devices/${name}`, import.meta.url), "utf8").trim();
const now = new Date("2026-11-24T00:00:00Z");
const path = "/api/integrations/devices";

it.each([
  ["ispindel", "ispindel.json", "application/json", 1.05398, 19.375],
  ["gravitymon", "gravitymon.json", "application/json", 1.005, 20.5],
  ["tilt", "tiltpi.txt", "application/x-www-form-urlencoded", 1.01, 18.33333],
  ["tilt", "tiltbridge.json", "application/json", 1.01, 18.33333],
  ["rapt", "rapt.json", "application/json", 1.0028, 2.74],
] as const)("normalizes %s saved payload %s", (kind, file, mime, gravitySg, temperatureC) => {
  const reading = parseDeviceReading(kind, deviceBody(read(file), mime), now);
  expect(reading.gravitySg).toBeCloseTo(gravitySg, 4);
  expect(reading.temperatureC).toBeCloseTo(temperatureC, 4);
  expect(reading).toMatchObject({ source: "device", takenAt: now.toISOString() });
});

it("handles explicit scaled gravity and rejects bad units, invalid ranges and repeated form fields", () => {
  expect(
    parseDeviceReading("rapt", { gravity: 1052.5, gravity_unit: "sg1000" }, now).gravitySg,
  ).toBe(1.0525);
  expect(() => parseDeviceReading("tilt", { gravity: 12 }, now)).toThrow("in-range");
  expect(() => parseDeviceReading("rapt", { temperature: 20, temp_unit: "K" }, now)).toThrow(
    "Unsupported",
  );
  expect(() => deviceBody("SG=1.04&SG=1.05", "application/x-www-form-urlencoded")).toThrow(
    "Repeated",
  );
});

it("requires a session for management", async () => {
  expect((await call(createApp(offlineDeps()), "GET", path)).status).toBe(401);
});

describe.skipIf(!TEST_DATABASE_URL)("device API on PostgreSQL", () => {
  it("issues a secret once, ingests readings, limits requests and invalidates rotated and revoked URLs", async () => {
    await withApp({}, async (app, sql) => {
      const { adminToken, annToken } = await twoUsers(app);
      const recipe = await call(app, "POST", "/api/recipes", {
        token: adminToken,
        body: {
          name: "Sensor test",
          beverage: "beer",
          batchSizeL: 20,
          content: {
            schemaVersion: 1,
            fermentables: [],
            hops: [],
            yeasts: [],
            miscs: [],
            mash: [],
            fermentation: [],
          },
        },
      });
      expect(recipe.status).toBe(201);
      const batch = await call(app, "POST", "/api/batches", {
        token: adminToken,
        body: { recipeId: recipe.json.id },
      });
      expect(batch.status).toBe(201);
      const config = { name: "Test Tilt", kind: "tilt", batchId: batch.json.id, tiltColor: "pink" };
      expect((await call(app, "POST", path, { token: annToken, body: config })).status).toBe(404);
      const issued = await call(app, "POST", path, { token: adminToken, body: config });
      expect(issued.status).toBe(201);
      expect(issued.res.headers.get("cache-control")).toBe("no-store");
      const url = new URL(issued.json.url as string);
      const secret = url.searchParams.get("token") as string;
      const { rows } = await sql.query("SELECT token_hash FROM integrations WHERE id = $1", [
        issued.json.id,
      ]);
      expect(rows[0]?.token_hash).toBe(hashSecret(secret));
      const listed = await call(app, "GET", path, { token: adminToken });
      expect(JSON.stringify(listed.json)).not.toContain(secret);
      expect(listed.json.items).toMatchObject([{ id: issued.json.id, lastSeenAt: null }]);

      const send = (to: URL, payload = read("tiltpi.txt")) =>
        app.request(to.pathname + to.search, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: payload,
        });
      const oversized = await send(url, `SG=1.04&Comment=${"x".repeat(17 * 1024)}`);
      expect(oversized.status).toBe(413);
      for (let i = 0; i < 12; i++) expect((await send(url)).status).toBe(200);
      const limited = await send(url);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      const readings = await call(app, "GET", `/api/batches/${batch.json.id}/readings`, {
        token: adminToken,
      });
      expect(readings.json).toHaveLength(12);
      expect(readings.json).toMatchObject(
        Array.from({ length: 12 }, () => ({ source: "device", gravitySg: 1.01 })),
      );

      const rotatePath = `${path}/${issued.json.id}/rotate`;
      expect((await call(app, "POST", rotatePath, { token: annToken })).status).toBe(404);
      const rotated = await call(app, "POST", rotatePath, { token: adminToken });
      expect(rotated.status).toBe(200);
      expect(rotated.json.lastSeenAt).toEqual(expect.any(String));
      const replacement = new URL(rotated.json.url as string);
      expect((await send(url)).status).toBe(401);
      expect((await send(replacement)).status).toBe(200);
      expect((await send(replacement, "SG=1.019&Temp=65&Color=GREEN")).status).toBe(200);
      const filtered = await call(app, "GET", `/api/batches/${batch.json.id}/readings`, {
        token: adminToken,
      });
      expect(filtered.json).toHaveLength(13);

      const brewery = await call(app, "POST", "/api/breweries", {
        token: adminToken,
        body: { name: "Device test brewery" },
      });
      expect(brewery.status).toBe(201);
      const moved = await call(app, "POST", `/api/batches/${batch.json.id}/move`, {
        token: adminToken,
        body: { breweryId: brewery.json.id },
      });
      expect(moved.status).toBe(200);
      expect((await send(replacement)).status).toBe(200);
      const reowned = await sql.query(
        "SELECT owner_user_id, owner_brewery_id FROM integrations WHERE id = $1",
        [issued.json.id],
      );
      expect(reowned.rows[0]).toEqual({ owner_user_id: null, owner_brewery_id: brewery.json.id });

      expect(
        (await call(app, "DELETE", `${path}/${issued.json.id}`, { token: adminToken })).status,
      ).toBe(204);
      expect((await send(replacement)).status).toBe(401);

      for (let i = 0; i < 20; i++) {
        const invalid = await call(
          app,
          "POST",
          `/api/device-readings?token=bb_${String(i).padStart(43, "0")}`,
          {
            ip: "203.0.113.1",
            body: JSON.parse(read("ispindel.json")),
          },
        );
        expect(invalid.status).toBe(401);
      }
      const nextBadToken = `/api/device-readings?token=bb_${"x".repeat(43)}`;
      const blocked = await call(app, "POST", nextBadToken, {
        ip: "203.0.113.1",
        body: JSON.parse(read("ispindel.json")),
      });
      expect(blocked.status).toBe(429);
      expect(blocked.res.headers.get("retry-after")).toBeTruthy();
      expect(
        (
          await call(app, "POST", nextBadToken, {
            ip: "203.0.113.2",
            body: JSON.parse(read("ispindel.json")),
          })
        ).status,
      ).toBe(401);
    });
  }, 20_000);
});
