// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipes API: versions, stats and style fit, visibility, imports, shares, forks, deletes,
// equipment profiles and scaling. Postgres tests need TEST_DATABASE_URL.
import { recipeStats, styleFit } from "@brew-bruvs/brew-math";
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import {
  admin,
  ann,
  call,
  type Json,
  offlineDeps,
  TEST_DATABASE_URL,
  type TestApp,
  twoUsers,
  withApp,
} from "./helpers.ts";

const content = {
  schemaVersion: 1,
  efficiencyPct: 72,
  fermentables: [
    { name: "Pale malt", kind: "grain", amountKg: 4.5, potentialSg: 1.037, colorEbc: 3.9 },
    { name: "Crystal 40", kind: "grain", amountKg: 0.35, potentialSg: 1.034, colorEbc: 79 },
  ],
  hops: [
    // Alpha acid comes from the catalog row.
    { name: "Magnum", catalogId: "hop-test", amountKg: 0.014, use: "boil", timeMin: 60 },
    { name: "Cascade", amountKg: 0.028, alphaAcidPct: 5.5, use: "boil", timeMin: 10 },
  ],
  yeasts: [{ name: "US-05", attenuationPct: 78 }],
  miscs: [],
  mash: [{ name: "Saccharification", type: "infusion", tempC: 66, timeMin: 60, infuseL: 14 }],
  fermentation: [],
};

const pale = {
  name: "House Pale",
  beverage: "beer",
  styleId: "style-apa",
  batchSizeL: 20,
  content,
};

const apaRanges = {
  ogMin: 1.045,
  ogMax: 1.06,
  fgMin: 1.01,
  fgMax: 1.015,
  abvMinPct: 4.5,
  abvMaxPct: 6.2,
  ibuMin: 30,
  ibuMax: 50,
  colorEbcMin: 9.85,
  colorEbcMax: 19.7,
};

const expectedStats = (() => {
  const r = recipeStats({
    volumeL: 20,
    efficiencyPct: 72,
    fermentables: [
      { kg: 4.5, potentialSg: 1.037, mashed: true, colorEbc: 3.9 },
      { kg: 0.35, potentialSg: 1.034, mashed: true, colorEbc: 79 },
    ],
    attenuationPct: 78,
    hops: [
      { alphaAcidPct: 10, hopGrams: 14, minutes: 60 },
      { alphaAcidPct: 5.5, hopGrams: 28, minutes: 10 },
    ],
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
})();

/** The APA style and a hop the recipe points at, without loading the whole catalog. */
async function seedCatalog(sql: Client) {
  await sql.query(
    `INSERT INTO styles (id, name, sources, licenses, style_guide, beverage, og_min, og_max, fg_min,
       fg_max, abv_min_pct, abv_max_pct, ibu_min, ibu_max, color_ebc_min, color_ebc_max)
     VALUES ('style-apa', 'American Pale Ale', '{test}', '{CC0-1.0}', 'BJCP 2021', 'beer',
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    Object.values(apaRanges),
  );
  await sql.query(
    `INSERT INTO hops (id, name, sources, licenses, alpha_acid_pct)
     VALUES ('hop-test', 'Magnum', '{test}', '{CC0-1.0}', 10)`,
  );
  await sql.query(
    `INSERT INTO equipment (id, name, sources, licenses) VALUES ('equip-test', 'Kit', '{test}', '{CC0-1.0}')`,
  );
}

type Ctx = { app: TestApp; sql: Client; owner: string; ann: string; annId: string };

/** The admin owns the recipes; Ann is another user on the same server. */
async function withRecipes(run: (ctx: Ctx) => Promise<void>) {
  await withApp({}, async (app, sql) => {
    await seedCatalog(sql);
    const { adminToken, annToken, annId } = await twoUsers(app);
    await run({ app, sql, owner: adminToken, ann: annToken, annId });
  });
}

async function create(ctx: Ctx, body: object = pale, token = ctx.owner) {
  const r = await call(ctx.app, "POST", "/api/recipes", { token, body });
  expect(r.status).toBe(201);
  return r.json as Json & { id: string; uri: string };
}

const visibility = (ctx: Ctx, id: string, body: object, token = ctx.owner) =>
  call(ctx.app, "PATCH", `/api/recipes/${id}`, { token, body });

const listed = async (ctx: Ctx, token: string | undefined, query = "") =>
  ((await call(ctx.app, "GET", `/api/recipes${query}`, { token })).json.items as Json[]).map(
    (r) => r.id,
  );

const code = (r: { json: Json }) => r.json.error?.code;

describe("recipes API without a database", () => {
  it("needs a session to write", async () => {
    const app = createApp(offlineDeps());
    for (const [method, path] of [
      ["POST", "/api/recipes"],
      ["GET", "/api/equipment-profiles"],
      ["POST", "/api/equipment-profiles"],
    ] as const) {
      const body =
        method === "POST" ? (path.endsWith("recipes") ? pale : { name: "Kit" }) : undefined;
      const r = await call(app, method, path, { body });
      expect(r.status, path).toBe(401);
    }
  });

  it("documents every recipe and equipment route", async () => {
    const r = await call(createApp(offlineDeps()), "GET", "/api/openapi.json");
    const paths = Object.keys(r.json.paths as object);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/recipes",
        "/api/recipes/{id}",
        "/api/recipes/{id}/versions",
        "/api/recipes/{id}/versions/{version}",
        "/api/recipes/{id}/fork",
        "/api/recipes/{id}/scale",
        "/api/recipes/{id}/shares",
        "/api/recipes/{id}/shares/{shareId}",
        "/api/equipment-profiles",
        "/api/equipment-profiles/{id}",
      ]),
    );
  });
});

describe.skipIf(!TEST_DATABASE_URL)("recipes API on Postgres (TEST_DATABASE_URL)", () => {
  it("creates a recipe with stats from brew-math and its style fit", async () => {
    await withRecipes(async (ctx) => {
      const recipe = await create(ctx);
      expect(recipe).toMatchObject({
        name: "House Pale",
        beverage: "beer",
        visibility: "private",
        owner: { type: "user" },
        credit: null,
        forkedFrom: null,
        latestVersion: 1,
        uri: `http://brew.test/recipes/${recipe.id}`,
        version: { version: 1, styleId: "style-apa", batchSizeL: 20, statsError: null },
      });
      const version = recipe.version as Json;
      expect(version.stats).toEqual(expectedStats);
      expect(version.styleFit).toEqual(styleFit(expectedStats, apaRanges));
      expect(version.styleFit).toMatchObject({ og: "inside", abvPct: "inside" });

      // Missing values give a reason instead of numbers.
      const noYeast = await create(ctx, { ...pale, content: { ...content, yeasts: [] } });
      expect(noYeast.version).toMatchObject({
        stats: null,
        statsError: expect.stringMatching(/yeast/),
      });
      expect((noYeast.version as Json).styleFit).toMatchObject({ og: "unknown" });
    });
  });

  it("rejects invalid recipes", async () => {
    await withRecipes(async (ctx) => {
      const bad = async (body: object, expected: string) => {
        const r = await call(ctx.app, "POST", "/api/recipes", { token: ctx.owner, body });
        expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400);
        expect(code(r)).toBe(expected);
      };
      await bad({ ...pale, content: { ...content, schemaVersion: 2 } }, "validation_error");
      await bad({ ...pale, beverage: "whisky" }, "validation_error");
      await bad({ ...pale, batchSizeL: -1 }, "validation_error");
      await bad({ ...pale, styleId: "style-nope" }, "unknown_style");
      await bad({ ...pale, equipmentProfileId: crypto.randomUUID() }, "unknown_equipment_profile");
      await bad(
        { ...pale, visibility: "public", credit: { sourceUrl: "https://site.test/r" } },
        "validation_error",
      );
    });
  });

  it("gets, lists and searches only what the caller may read", async () => {
    await withRecipes(async (ctx) => {
      const mine = await create(ctx);
      const annsOwn = await create(ctx, { ...pale, name: "Ann's Stout", styleId: null }, ctx.ann);

      expect(
        (await call(ctx.app, "GET", `/api/recipes/${mine.id}`, { token: ctx.owner })).status,
      ).toBe(200);
      // Private: someone else, or nobody signed in, gets "not found".
      for (const token of [ctx.ann, undefined]) {
        const r = await call(ctx.app, "GET", `/api/recipes/${mine.id}`, { token });
        expect(r.status).toBe(404);
        expect(
          (await call(ctx.app, "GET", `/api/recipes/${mine.id}/versions`, { token })).status,
        ).toBe(404);
        expect(
          (await call(ctx.app, "GET", `/api/recipes/${mine.id}/versions/1`, { token })).status,
        ).toBe(404);
      }
      expect(await listed(ctx, ctx.owner)).toEqual([mine.id]);
      expect(await listed(ctx, ctx.ann)).toEqual([annsOwn.id]);
      expect(await listed(ctx, undefined)).toEqual([]);

      await visibility(ctx, annsOwn.id, { visibility: "server" }, ctx.ann);
      expect(await listed(ctx, ctx.owner)).toEqual([annsOwn.id, mine.id]);
      expect(await listed(ctx, ctx.owner, "?mine=true")).toEqual([mine.id]);
      expect(await listed(ctx, ctx.owner, "?q=STOUT")).toEqual([annsOwn.id]);
      expect(await listed(ctx, ctx.owner, "?limit=1")).toEqual([annsOwn.id]);
      const page = await call(ctx.app, "GET", "/api/recipes?limit=1&offset=1", {
        token: ctx.owner,
      });
      expect(page.json).toMatchObject({ items: [{ id: mine.id }], nextOffset: null });

      const anonymousMine = await call(ctx.app, "GET", "/api/recipes?mine=true");
      expect(anonymousMine.status).toBe(401);
      const badQuery = await call(ctx.app, "GET", "/api/recipes?limit=500", { token: ctx.owner });
      expect(badQuery.status).toBe(400);
      expect(
        (await call(ctx.app, "GET", "/api/recipes/not-a-uuid", { token: ctx.owner })).status,
      ).toBe(400);
    });
  });

  it("saves each change as a new version and keeps the old ones", async () => {
    await withRecipes(async (ctx) => {
      const recipe = await create(ctx);
      const path = `/api/recipes/${recipe.id}/versions`;
      const changed = { ...pale, name: "House Pale v2", batchSizeL: 23 };
      delete (changed as { beverage?: string }).beverage;

      const saved = await call(ctx.app, "POST", path, { token: ctx.owner, body: changed });
      expect(saved.status).toBe(201);
      expect(saved.json).toMatchObject({ version: 2, name: "House Pale v2", batchSizeL: 23 });

      const detail = await call(ctx.app, "GET", `/api/recipes/${recipe.id}`, { token: ctx.owner });
      expect(detail.json).toMatchObject({
        name: "House Pale v2",
        latestVersion: 2,
        version: { version: 2 },
      });
      const versions = await call(ctx.app, "GET", path, { token: ctx.owner });
      expect((versions.json as unknown as Json[]).map((v) => v.version)).toEqual([2, 1]);
      const first = await call(ctx.app, "GET", `${path}/1`, { token: ctx.owner });
      expect(first.json).toMatchObject({ version: 1, name: "House Pale", batchSizeL: 20 });
      expect(first.json.stats).toEqual(expectedStats);
      expect((await call(ctx.app, "GET", `${path}/9`, { token: ctx.owner })).status).toBe(404);

      // Not readable: not found. Readable but not editable: forbidden.
      expect((await call(ctx.app, "POST", path, { token: ctx.ann, body: changed })).status).toBe(
        404,
      );
      await visibility(ctx, recipe.id, { visibility: "server" });
      const forbidden = await call(ctx.app, "POST", path, { token: ctx.ann, body: changed });
      expect(forbidden.status).toBe(403);
      expect(code(forbidden)).toBe("forbidden");

      const invalid = await call(ctx.app, "POST", path, {
        token: ctx.owner,
        body: {
          ...changed,
          content: { ...content, hops: [{ name: "x", amountKg: 1, use: "boil" }] },
        },
      });
      expect(invalid.status).toBe(400);
    });
  });

  it("visibility: unlisted by link only, server for signed-in users, public for all", async () => {
    await withRecipes(async (ctx) => {
      const { id } = await create(ctx);
      const get = (token?: string) => call(ctx.app, "GET", `/api/recipes/${id}`, { token });

      const unlisted = await visibility(ctx, id, { visibility: "unlisted" });
      expect(unlisted.status).toBe(200);
      expect(unlisted.json.visibility).toBe("unlisted");
      expect((await get(undefined)).status).toBe(200);
      expect((await get(ctx.ann)).status).toBe(200);
      expect(await listed(ctx, ctx.ann)).toEqual([]);
      expect(await listed(ctx, ctx.owner)).toEqual([id]);

      await visibility(ctx, id, { visibility: "server" });
      expect((await get(undefined)).status).toBe(404);
      expect(await listed(ctx, ctx.ann)).toEqual([id]);
      expect(await listed(ctx, undefined)).toEqual([]);

      await visibility(ctx, id, { visibility: "public" });
      expect(await listed(ctx, undefined)).toEqual([id]);

      // Readers can't change it; nonsense values are refused.
      const forbidden = await visibility(ctx, id, { visibility: "private" }, ctx.ann);
      expect(forbidden.status).toBe(403);
      expect((await visibility(ctx, id, { visibility: "everyone" })).status).toBe(400);
      // Anonymous visitors can read a public recipe but not change it.
      expect((await visibility(ctx, id, { visibility: "private" }, "")).status).toBe(403);
    });
  });

  it("imported recipes start private, need confirmation to go public, and can be blocked", async () => {
    await withRecipes(async (ctx) => {
      const credit = {
        sourceUrl: "https://site.test/pale",
        site: "Site",
        author: "Bo",
        license: "CC-BY-4.0",
      };
      const imported = await create(ctx, { ...pale, credit });
      expect(imported.visibility).toBe("private");
      expect(imported.credit).toMatchObject({ ...credit, importedAt: expect.any(String) });

      for (const v of ["public", "unlisted"]) {
        const r = await visibility(ctx, imported.id, { visibility: v });
        expect(r.status).toBe(400);
        expect(code(r)).toBe("confirm_public");
      }
      expect((await visibility(ctx, imported.id, { visibility: "server" })).status).toBe(200);
      const confirmed = await visibility(ctx, imported.id, {
        visibility: "public",
        confirmPublic: true,
      });
      expect(confirmed.status).toBe(200);

      const blocked = await create(ctx, {
        ...pale,
        credit: { ...credit, publicSharingBlocked: true },
      });
      expect(blocked.publicSharingBlocked).toBe(true);
      for (const v of ["public", "unlisted"]) {
        const r = await visibility(ctx, blocked.id, { visibility: v, confirmPublic: true });
        expect(r.status).toBe(409);
        expect(code(r)).toBe("public_sharing_blocked");
      }
      expect((await visibility(ctx, blocked.id, { visibility: "server" })).status).toBe(200);
    });
  });

  it("shares with a user by email, read or edit, and stops sharing", async () => {
    await withRecipes(async (ctx) => {
      const { id } = await create(ctx);
      const sharesPath = `/api/recipes/${id}/shares`;
      const share = (body: object, token = ctx.owner) =>
        call(ctx.app, "POST", sharesPath, { token, body });
      const save = () =>
        call(ctx.app, "POST", `/api/recipes/${id}/versions`, {
          token: ctx.ann,
          body: { name: "Ann's tweak", batchSizeL: 20, content },
        });

      const read = await share({ email: ann.email.toUpperCase(), level: "read" });
      expect(read.status).toBe(201);
      expect(read.json).toMatchObject({
        user: { id: ctx.annId, displayName: "Ann" },
        level: "read",
      });
      expect((await call(ctx.app, "GET", `/api/recipes/${id}`, { token: ctx.ann })).status).toBe(
        200,
      );
      expect(await listed(ctx, ctx.ann)).toEqual([id]);
      expect((await save()).status).toBe(403);
      // Ann can read it, but only people who can share it see the share list.
      expect((await call(ctx.app, "GET", sharesPath, { token: ctx.ann })).status).toBe(403);
      expect((await share({ email: admin.email, level: "edit" }, ctx.ann)).status).toBe(403);

      const edit = await share({ email: ann.email, level: "edit" });
      expect(edit.json).toMatchObject({ id: read.json.id, level: "edit" });
      expect((await save()).status).toBe(201);
      const list = await call(ctx.app, "GET", sharesPath, { token: ctx.owner });
      expect(list.json).toEqual([
        expect.objectContaining({ id: read.json.id, level: "edit", breweryId: null }),
      ]);

      expect(code(await share({ email: "nobody@brew.test", level: "read" }))).toBe(
        "user_not_found",
      );
      expect(code(await share({ email: admin.email, level: "read" }))).toBe(
        "cannot_share_with_owner",
      );
      expect(code(await share({ breweryId: crypto.randomUUID(), level: "read" }))).toBe(
        "brewery_not_found",
      );
      expect(
        (await share({ email: ann.email, breweryId: crypto.randomUUID(), level: "read" })).status,
      ).toBe(400);
      expect((await share({ email: ann.email, level: "admin" })).status).toBe(400);

      const shareId = read.json.id as string;
      expect(
        (await call(ctx.app, "DELETE", `${sharesPath}/${shareId}`, { token: ctx.ann })).status,
      ).toBe(403);
      expect(
        (await call(ctx.app, "DELETE", `${sharesPath}/${shareId}`, { token: ctx.owner })).status,
      ).toBe(204);
      expect(
        (await call(ctx.app, "DELETE", `${sharesPath}/${shareId}`, { token: ctx.owner })).status,
      ).toBe(404);
      expect((await call(ctx.app, "GET", `/api/recipes/${id}`, { token: ctx.ann })).status).toBe(
        404,
      );
    });
  });

  it("forks into the forker's ownership with a permanent forked-from credit", async () => {
    await withRecipes(async (ctx) => {
      const credit = { sourceUrl: "https://site.test/pale", publicSharingBlocked: true };
      const original = await create(ctx, { ...pale, credit });
      const fork = (token: string | undefined, body: object = {}) =>
        call(ctx.app, "POST", `/api/recipes/${original.id}/fork`, { token, body });

      expect((await fork(ctx.ann)).status).toBe(404);
      await visibility(ctx, original.id, { visibility: "server" });
      expect((await fork(undefined)).status).toBe(401);
      expect((await fork(ctx.ann, { name: "" })).status).toBe(400);

      const r = await fork(ctx.ann, { name: "Ann's Pale" });
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({
        name: "Ann's Pale",
        visibility: "private",
        owner: { type: "user", id: ctx.annId },
        forkedFrom: { uri: original.uri, recipeId: original.id },
        // Import credit and its restriction travel with the copy.
        credit: { sourceUrl: credit.sourceUrl },
        publicSharingBlocked: true,
        version: { version: 1, name: "Ann's Pale", stats: expectedStats },
      });
      const forkId = r.json.id as string;
      expect(await listed(ctx, ctx.ann, "?mine=true")).toEqual([forkId]);

      // Deleting the original clears only the local link.
      expect(
        (await call(ctx.app, "DELETE", `/api/recipes/${original.id}`, { token: ctx.owner })).status,
      ).toBe(204);
      const after = await call(ctx.app, "GET", `/api/recipes/${forkId}`, { token: ctx.ann });
      expect(after.json.forkedFrom).toEqual({ uri: original.uri, recipeId: null });
    });
  });

  it("deletes recipes, their versions and shares, but not while batches use them", async () => {
    await withRecipes(async (ctx) => {
      const { id } = await create(ctx);
      await call(ctx.app, "POST", `/api/recipes/${id}/shares`, {
        token: ctx.owner,
        body: { email: ann.email, level: "edit" },
      });
      // Editing doesn't include deleting.
      expect((await call(ctx.app, "DELETE", `/api/recipes/${id}`, { token: ctx.ann })).status).toBe(
        403,
      );
      expect((await call(ctx.app, "DELETE", `/api/recipes/${id}`)).status).toBe(404);

      const used = await create(ctx);
      const { rows } = await ctx.sql.query<{ id: string; owner_user_id: string }>(
        "SELECT v.id, r.owner_user_id FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id WHERE r.id = $1",
        [used.id],
      );
      await ctx.sql.query(
        `INSERT INTO batches (uri, owner_user_id, recipe_version_id, name, beverage)
         VALUES ('https://brew.test/b/1', $1, $2, 'Batch 1', 'beer')`,
        [rows[0]?.owner_user_id, rows[0]?.id],
      );
      const inUse = await call(ctx.app, "DELETE", `/api/recipes/${used.id}`, { token: ctx.owner });
      expect(inUse.status).toBe(409);
      expect(code(inUse)).toBe("recipe_in_use");

      expect(
        (await call(ctx.app, "DELETE", `/api/recipes/${id}`, { token: ctx.owner })).status,
      ).toBe(204);
      expect((await call(ctx.app, "GET", `/api/recipes/${id}`, { token: ctx.owner })).status).toBe(
        404,
      );
      const left = await ctx.sql.query(
        "SELECT (SELECT count(*) FROM recipe_versions WHERE recipe_id = $1) + (SELECT count(*) FROM shares WHERE resource_id = $1) AS n",
        [id],
      );
      expect(Number(left.rows[0].n)).toBe(0);
    });
  });

  it("manages equipment profiles and scales a recipe to one", async () => {
    await withRecipes(async (ctx) => {
      const base = "/api/equipment-profiles";
      const make = (body: object, token = ctx.owner) =>
        call(ctx.app, "POST", base, { token, body });

      const big = await make({
        name: "Big kettle",
        catalogId: "equip-test",
        batchSizeL: 40,
        efficiencyPct: 80,
        boilSizeL: 48,
      });
      expect(big.status).toBe(201);
      expect(big.json).toMatchObject({
        name: "Big kettle",
        batchSizeL: 40,
        efficiencyPct: 80,
        kettleLossL: null,
      });
      const bigId = big.json.id as string;
      const noSize = await make({ name: "Bucket" });
      expect((await make({ name: "Bad", efficiencyPct: 120 })).status).toBe(400);
      expect(code(await make({ name: "Bad", catalogId: "equip-nope" }))).toBe("unknown_catalog_id");

      const list = await call(ctx.app, "GET", base, { token: ctx.owner });
      expect((list.json as unknown as Json[]).map((p) => p.name)).toEqual(["Big kettle", "Bucket"]);
      expect((await call(ctx.app, "GET", base, { token: ctx.ann })).json).toEqual([]);
      expect((await call(ctx.app, "GET", `${base}/${bigId}`, { token: ctx.owner })).json.name).toBe(
        "Big kettle",
      );

      const patched = await call(ctx.app, "PATCH", `${base}/${bigId}`, {
        token: ctx.owner,
        body: { kettleLossL: 1.5, catalogId: null },
      });
      expect(patched.json).toMatchObject({ kettleLossL: 1.5, catalogId: null, batchSizeL: 40 });
      expect(
        (await call(ctx.app, "PATCH", `${base}/${bigId}`, { token: ctx.owner, body: {} })).status,
      ).toBe(200);
      expect(
        (
          await call(ctx.app, "PATCH", `${base}/${bigId}`, {
            token: ctx.owner,
            body: { boilSizeL: 0 },
          })
        ).status,
      ).toBe(400);
      // Other people's profiles don't exist as far as they can tell.
      for (const [method, body] of [
        ["GET"],
        ["PATCH", { name: "Mine now" }],
        ["DELETE"],
      ] as const) {
        const r = await call(ctx.app, method, `${base}/${bigId}`, { token: ctx.ann, body });
        expect(r.status, method).toBe(404);
      }

      const recipe = await create(ctx);
      const scale = (body: object, token = ctx.owner) =>
        call(ctx.app, "POST", `/api/recipes/${recipe.id}/scale`, { token, body });
      const scaled = await scale({ equipmentProfileId: bigId });
      expect(scaled.status).toBe(200);
      expect(scaled.json).toMatchObject({
        batchSizeL: 40,
        equipmentProfileId: bigId,
        statsError: null,
      });
      const scaledContent = scaled.json.content as typeof content;
      expect(scaledContent.efficiencyPct).toBe(80);
      expect(scaledContent.fermentables[0]?.amountKg).toBeCloseTo((4.5 * 2 * 72) / 80, 12);
      expect(scaledContent.hops[1]?.amountKg).toBeCloseTo(0.056, 12);
      const stats = scaled.json.stats as typeof expectedStats;
      expect(stats.og).toBeCloseTo(expectedStats.og, 12);
      // Nothing was saved.
      expect(
        (await call(ctx.app, "GET", `/api/recipes/${recipe.id}`, { token: ctx.owner })).json
          .latestVersion,
      ).toBe(1);

      expect(code(await scale({ equipmentProfileId: noSize.json.id }))).toBe("profile_incomplete");
      expect(code(await scale({ equipmentProfileId: crypto.randomUUID() }))).toBe(
        "unknown_equipment_profile",
      );
      expect((await scale({ equipmentProfileId: bigId, version: 5 })).status).toBe(404);
      expect((await scale({})).status).toBe(400);
      expect((await scale({ equipmentProfileId: bigId }, ctx.ann)).status).toBe(404);
      await visibility(ctx, recipe.id, { visibility: "server" });
      // Ann can read the recipe but not the owner's profile.
      expect(code(await scale({ equipmentProfileId: bigId }, ctx.ann))).toBe(
        "unknown_equipment_profile",
      );

      // A version can use the profile; deleting the profile keeps the version.
      const saved = await call(ctx.app, "POST", `/api/recipes/${recipe.id}/versions`, {
        token: ctx.owner,
        body: {
          name: "Big batch",
          batchSizeL: 40,
          equipmentProfileId: bigId,
          content: scaledContent,
        },
      });
      expect(saved.json).toMatchObject({ version: 2, equipmentProfileId: bigId });
      const annProfile = await make({ name: "Ann's kit", batchSizeL: 10 }, ctx.ann);
      const notHers = await call(ctx.app, "POST", `/api/recipes/${recipe.id}/versions`, {
        token: ctx.owner,
        body: { name: "x", batchSizeL: 20, equipmentProfileId: annProfile.json.id, content },
      });
      expect(code(notHers)).toBe("unknown_equipment_profile");

      expect((await call(ctx.app, "DELETE", `${base}/${bigId}`, { token: ctx.owner })).status).toBe(
        204,
      );
      expect((await call(ctx.app, "GET", `${base}/${bigId}`, { token: ctx.owner })).status).toBe(
        404,
      );
      const kept = await call(ctx.app, "GET", `/api/recipes/${recipe.id}/versions/2`, {
        token: ctx.owner,
      });
      expect(kept.json).toMatchObject({
        name: "Big batch",
        batchSizeL: 40,
        equipmentProfileId: null,
      });
    });
  });
});
