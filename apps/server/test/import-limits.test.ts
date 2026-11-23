// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipe imports are rate limited per user and per IP, and URL fetches are capped server-wide,
// so the server can't be used to hammer other sites. Postgres tests need TEST_DATABASE_URL.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS } from "../src/routes/recipe-files.ts";
import type { createRecipeFileService } from "../src/services/recipe-files.ts";
import { call, invite, setupAdmin, TEST_DATABASE_URL, type TestApp, withApp } from "./helpers.ts";

type ReadUrl = NonNullable<Parameters<typeof createRecipeFileService>[1]>;

const page = readFileSync(new URL("./fixtures/recipe-pages/schema.html", import.meta.url), "utf8");
const xml = readFileSync(new URL("./fixtures/recipe-files/external.xml", import.meta.url), "utf8");
const source = "https://recipes.example.test/recipe";

/** Reads the saved fixture page instead of the network; `gate` holds each read open. */
function fakeReader(gate?: Promise<void>): ReadUrl {
  return (async (_input, read) => {
    await gate;
    return read({ url: new URL(source), body: page }, async () => "");
  }) as ReadUrl;
}

async function brewer(app: TestApp, adminToken: string, n: number) {
  const r = await call(app, "POST", "/api/auth/signup", {
    body: {
      email: `brewer${n}@brew.test`,
      password: "brewer-password",
      displayName: `Brewer ${n}`,
      inviteCode: await invite(app, adminToken),
      client: "app",
    },
    ip: `198.51.100.${n}`,
  });
  expect(r.status).toBe(201);
  return r.json.token as string;
}

const importUrl = (app: TestApp, token: string, ip: string) =>
  call(app, "POST", "/api/recipes/import-url", { token, body: { url: source }, ip });

describe.skipIf(!TEST_DATABASE_URL)("recipe import limits (TEST_DATABASE_URL)", () => {
  it("limits URL imports per user, then per IP", async () => {
    await withApp({ readRecipeUrl: fakeReader() }, async (app) => {
      const adminToken = await setupAdmin(app);
      for (let i = 0; i < IMPORT_LIMITS.urlPerUser; i++) {
        expect((await importUrl(app, adminToken, `203.0.113.${i}`)).status).toBe(200);
      }
      // A new address doesn't help the same account.
      const user = await importUrl(app, adminToken, "203.0.113.200");
      expect(user.status).toBe(429);
      expect(user.json.error?.code).toBe("rate_limited");
      expect(Number(user.res.headers.get("retry-after"))).toBeGreaterThan(0);

      // Several accounts behind one address share the per-IP budget.
      const ip = "192.0.2.50";
      let used = 0;
      for (let n = 1; used < IMPORT_LIMITS.urlPerIp; n++) {
        const token = await brewer(app, adminToken, n);
        for (let i = 0; i < IMPORT_LIMITS.urlPerUser && used < IMPORT_LIMITS.urlPerIp; i++) {
          expect((await importUrl(app, token, ip)).status).toBe(200);
          used++;
        }
      }
      const fresh = await brewer(app, adminToken, 99);
      expect((await importUrl(app, fresh, ip)).status).toBe(429);
      expect((await importUrl(app, fresh, "192.0.2.51")).status).toBe(200);
    });
  }, 120_000);

  it("caps URL fetches running at once", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await withApp({ readRecipeUrl: fakeReader(gate) }, async (app) => {
      const token = await setupAdmin(app);
      const running = Array.from({ length: IMPORT_LIMITS.concurrentUrlFetches }, (_, i) =>
        importUrl(app, token, `203.0.113.${i}`),
      );
      // Let the held requests reach the reader before trying one more.
      await new Promise((resolve) => setTimeout(resolve, 200));
      const busy = await importUrl(app, token, "203.0.113.99");
      expect(busy.status).toBe(429);
      expect(busy.json.error?.code).toBe("import_busy");
      expect(busy.res.headers.get("retry-after")).toBeTruthy();

      release();
      for (const r of await Promise.all(running)) expect(r.status).toBe(200);
      // A finished fetch frees its slot.
      expect((await importUrl(app, token, "203.0.113.100")).status).toBe(200);
    });
  }, 60_000);

  it("limits file imports per user", async () => {
    await withApp({}, async (app) => {
      const token = await setupAdmin(app);
      const upload = (as = token) =>
        call(app, "POST", "/api/recipes/import", {
          token: as,
          body: { format: "beerxml", contents: xml },
        });
      for (let i = 0; i < IMPORT_LIMITS.filePerUser; i++) expect((await upload()).status).toBe(200);
      const limited = await upload();
      expect(limited.status).toBe(429);
      expect(limited.json.error?.code).toBe("rate_limited");
      // Other accounts are unaffected.
      expect((await upload(await brewer(app, token, 1))).status).toBe(200);
    });
  }, 120_000);
});
