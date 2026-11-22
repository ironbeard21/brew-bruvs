// SPDX-License-Identifier: AGPL-3.0-or-later
// Lightweight local E2E server serving the built Expo web bundle (dist/) alongside
// the P0-11 auth, P1-04 catalog, and P1-05 recipe OpenAPI contracts so Playwright tests
// run locally without requiring an external Postgres database.
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";

const PORT = Number(process.env.PORT ?? "4173");
const WEB_DIR = resolve(process.env.WEB_DIR ?? "./dist");
const SESSION_COOKIE = "bb_session";

interface StoredUser {
  id: string;
  uri: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  password: string;
}

interface StoredVersion {
  id: string;
  version: number;
  name: string;
  beverage: "beer" | "mead" | "wine" | "cider";
  styleId: string | null;
  batchSizeL: number;
  equipmentProfileId: string | null;
  content: Record<string, unknown>;
  createdAt: string;
  stats: null;
  statsError: null;
  styleFit: null;
}

interface StoredRecipe {
  id: string;
  uri: string;
  name: string;
  beverage: "beer" | "mead" | "wine" | "cider";
  visibility: "private" | "unlisted" | "server" | "public";
  owner: { type: "user"; id: string };
  credit: null;
  forkedFrom: { uri: string; recipeId: string | null } | null;
  publicSharingBlocked: boolean;
  createdAt: string;
  updatedAt: string;
  versions: StoredVersion[];
  shares: {
    id: string;
    user: { id: string; displayName: string } | null;
    breweryId: null;
    level: "read" | "edit";
    createdAt: string;
  }[];
}

const users = new Map<string, StoredUser>();
const sessions = new Map<string, string>();
const recipes = new Map<string, StoredRecipe>();
const equipmentProfiles: Record<string, unknown>[] = [];

const SEEDED_CATALOG: Record<string, Record<string, unknown>[]> = {
  styles: [
    {
      id: "style-bjcp-2015-18b",
      catalog: "styles",
      name: "American Pale Ale",
      styleGuide: "BJCP 2015",
      styleId: "18B",
      category: "Pale American Ale",
      beverage: "beer",
      ogMin: 1.045,
      ogMax: 1.06,
      fgMin: 1.01,
      fgMax: 1.015,
      ibuMin: 30,
      ibuMax: 50,
      colorEbcMin: 9.85,
      colorEbcMax: 19.7,
      abvMinPct: 4.5,
      abvMaxPct: 6.2,
      carbVolsMin: 1.5,
      carbVolsMax: 3.0,
      aliases: [],
      sources: ["bjcpjson"],
      licenses: ["MIT"],
      notes: null,
    },
  ],
  fermentables: [
    {
      id: "ferm-pale-malt-2-row-us",
      catalog: "fermentables",
      name: "Pale Malt (2 Row) US",
      aliases: [],
      sources: ["bt001"],
      licenses: ["GPL-3.0"],
      notes: null,
      fermentableType: "grain",
      producer: null,
      productId: null,
      origin: "US",
      category: null,
      colorEbc: 3.8,
      yieldPct: 79.0,
      potentialSg: 1.0365,
      maxInBatchPct: 100.0,
      diastaticPowerLintner: null,
      proteinPct: null,
      moisturePct: null,
      beverages: ["beer"],
    },
    {
      id: "ferm-caramel-crystal-malt-60l",
      catalog: "fermentables",
      name: "Caramel/Crystal Malt – 60L",
      aliases: [],
      sources: ["bt001"],
      licenses: ["GPL-3.0"],
      notes: null,
      fermentableType: "grain",
      producer: null,
      productId: null,
      origin: "US",
      category: "Grain",
      colorEbc: 158.9,
      yieldPct: 74.0,
      potentialSg: 1.0342,
      maxInBatchPct: 20.0,
      diastaticPowerLintner: null,
      proteinPct: null,
      moisturePct: null,
      beverages: ["beer"],
    },
  ],
  hops: [
    {
      id: "hop-columbus",
      catalog: "hops",
      name: "Columbus",
      aliases: ["Zeus", "Tomahawk", "CTZ"],
      sources: ["bt003"],
      licenses: ["GPL-3.0"],
      notes: null,
      origin: "United States of America (USA)",
      hopType: "aroma/bittering",
      alphaAcidPct: 16.0,
      alphaAcidMinPct: 13.8,
      alphaAcidMaxPct: 17.5,
      betaAcidPct: null,
      cohumulonePct: null,
      totalOilMlPer100g: null,
      myrcenePct: null,
      humulenePct: null,
      caryophyllenePct: null,
      farnesenePct: null,
      hsi: null,
      substitutes: null,
      beverages: ["beer"],
    },
  ],
  yeasts: [
    {
      id: "yeast-fermentis-us-05",
      catalog: "yeasts",
      name: "Safale American Ale",
      aliases: ["SafAle US-05", "Safale American"],
      sources: ["beerproto"],
      licenses: ["MIT"],
      notes: null,
      producer: "Fermentis",
      productId: "US-05",
      yeastType: "ale",
      form: "dry",
      tempMinC: 12.0,
      tempMaxC: 25.0,
      attenuationMinPct: 81.0,
      attenuationMaxPct: 81.0,
      flocculation: "medium",
      alcoholTolerancePct: 10.0,
      bestFor: "American Ales",
      beverages: ["beer"],
    },
  ],
  miscs: [],
  water_profiles: [],
  equipment: [],
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function publicUser(user: StoredUser) {
  return {
    id: user.id,
    uri: user.uri,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  };
}

function recipeSummary(r: StoredRecipe) {
  return {
    id: r.id,
    uri: r.uri,
    name: r.name,
    beverage: r.beverage,
    visibility: r.visibility,
    owner: r.owner,
    credit: r.credit,
    forkedFrom: r.forkedFrom,
    publicSharingBlocked: r.publicSharingBlocked,
    latestVersion: r.versions[r.versions.length - 1]?.version ?? 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function recipeDetail(r: StoredRecipe) {
  return {
    ...recipeSummary(r),
    version: r.versions[r.versions.length - 1],
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function getSessionSecret(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return v.join("=");
  }
  return null;
}

function getUserForRequest(req: IncomingMessage): StoredUser | null {
  const secret = getSessionSecret(req);
  if (!secret) return null;
  const userId = sessions.get(secret);
  return userId ? (users.get(userId) ?? null) : null;
}

function issueSession(user: StoredUser, clientKind: "web" | "app") {
  const secret = randomBytes(24).toString("hex");
  sessions.set(secret, user.id);
  if (clientKind === "app") {
    return { body: { user: publicUser(user), token: secret }, cookie: undefined };
  }
  return {
    body: { user: publicUser(user) },
    cookie: `${SESSION_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax`,
  };
}

function serveFile(res: ServerResponse, filePath: string) {
  const ext = extname(filePath);
  res.writeHead(200, { "content-type": MIME_TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  if (pathname === "/healthz" && method === "GET") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (pathname === "/api/auth/status" && method === "GET") {
    return sendJson(res, 200, {
      setupNeeded: users.size === 0,
      signupMode: "invite",
      oidcEnabled: false,
    });
  }

  if (pathname === "/api/me" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    return sendJson(res, 200, publicUser(user));
  }

  if (pathname === "/api/setup" && method === "POST") {
    if (users.size > 0) {
      return sendJson(res, 409, {
        error: { code: "setup_closed", message: "First-run setup is already complete" },
      });
    }
    const data = JSON.parse(await readBody(req)) as {
      email?: string;
      password?: string;
      displayName?: string;
      client?: "web" | "app";
    };
    if (!data.email || !data.password || data.password.length < 8 || !data.displayName) {
      return sendJson(res, 400, {
        error: { code: "validation_error", message: "Invalid setup fields" },
      });
    }
    const id = randomUUID();
    const user: StoredUser = {
      id,
      uri: `http://127.0.0.1:${PORT}/users/${id}`,
      email: data.email.trim(),
      displayName: data.displayName.trim(),
      isAdmin: true,
      password: data.password,
    };
    users.set(id, user);
    const issued = issueSession(user, data.client ?? "web");
    return sendJson(res, 201, issued.body, issued.cookie);
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const data = JSON.parse(await readBody(req)) as {
      email?: string;
      password?: string;
      client?: "web" | "app";
    };
    const match = [...users.values()].find(
      (u) => u.email.toLowerCase() === (data.email ?? "").trim().toLowerCase(),
    );
    if (!match || match.password !== data.password) {
      return sendJson(res, 401, {
        error: { code: "invalid_credentials", message: "Wrong email or password" },
      });
    }
    const issued = issueSession(match, data.client ?? "web");
    return sendJson(res, 200, issued.body, issued.cookie);
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const secret = getSessionSecret(req);
    if (!secret || !sessions.has(secret)) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    sessions.delete(secret);
    res.writeHead(204, { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
    res.end();
    return;
  }

  // Catalog search & get-by-id
  const catalogMatch = pathname.match(/^\/api\/catalog\/([^/]+)(?:\/([^/]+))?$/);
  if (catalogMatch && method === "GET") {
    const catalog = catalogMatch[1] ?? "";
    const itemId = catalogMatch[2];
    const list = SEEDED_CATALOG[catalog] ?? [];
    if (itemId) {
      const found = list.find((item) => item.id === itemId);
      if (!found) return sendJson(res, 404, { error: { code: "not_found", message: "Not found" } });
      return sendJson(res, 200, found);
    }
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const items = q
      ? list.filter((item) => {
          const hay = [
            String(item.name ?? ""),
            String(item.styleId ?? ""),
            String(item.productId ?? ""),
            ...((item.aliases as string[] | undefined) ?? []),
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : list;
    return sendJson(res, 200, { items, nextOffset: null });
  }

  // Equipment profiles
  if (pathname === "/api/equipment-profiles" && method === "GET") {
    return sendJson(res, 200, equipmentProfiles);
  }
  if (pathname === "/api/equipment-profiles" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as Record<string, unknown>;
    const now = new Date().toISOString();
    const id = randomUUID();
    const profile = {
      id,
      uri: `http://127.0.0.1:${PORT}/equipment-profiles/${id}`,
      name: String(data.name ?? "Profile"),
      catalogId: null,
      batchSizeL: data.batchSizeL ?? null,
      boilSizeL: data.boilSizeL ?? null,
      kettleVolumeL: null,
      kettleLossL: null,
      boilRateLPerHr: null,
      mashTunVolumeL: null,
      grainAbsorptionLPerKg: null,
      efficiencyPct: data.efficiencyPct ?? null,
      fermenterLossL: null,
      createdAt: now,
      updatedAt: now,
    };
    equipmentProfiles.push(profile);
    return sendJson(res, 201, profile);
  }

  // Recipes CRUD, versions, fork, shares
  if (pathname === "/api/recipes" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const list = [...recipes.values()]
      .filter((r) => (!q ? true : r.name.toLowerCase().includes(q)))
      .map(recipeSummary);
    return sendJson(res, 200, { items: list, nextOffset: null });
  }
  if (pathname === "/api/recipes" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as {
      name: string;
      beverage: "beer" | "mead" | "wine" | "cider";
      styleId?: string | null;
      batchSizeL: number;
      equipmentProfileId?: string | null;
      visibility?: "private" | "unlisted" | "server" | "public";
      content: Record<string, unknown>;
    };
    const id = randomUUID();
    const now = new Date().toISOString();
    const version: StoredVersion = {
      id: randomUUID(),
      version: 1,
      name: data.name,
      beverage: data.beverage,
      styleId: data.styleId ?? null,
      batchSizeL: data.batchSizeL,
      equipmentProfileId: data.equipmentProfileId ?? null,
      content: data.content,
      createdAt: now,
      stats: null,
      statsError: null,
      styleFit: null,
    };
    const recipe: StoredRecipe = {
      id,
      uri: `http://127.0.0.1:${PORT}/recipes/${id}`,
      name: data.name,
      beverage: data.beverage,
      visibility: data.visibility ?? "private",
      owner: { type: "user", id: user.id },
      credit: null,
      forkedFrom: null,
      publicSharingBlocked: false,
      createdAt: now,
      updatedAt: now,
      versions: [version],
      shares: [],
    };
    recipes.set(id, recipe);
    return sendJson(res, 201, recipeDetail(recipe));
  }

  const recipeSub = pathname.match(
    /^\/api\/recipes\/([^/]+)(?:\/(versions|fork|shares)(?:\/([^/]+))?)?$/,
  );
  if (recipeSub) {
    const recipeId = recipeSub[1] ?? "";
    const sub = recipeSub[2];
    const subId = recipeSub[3];
    const recipe = recipes.get(recipeId);
    if (!recipe)
      return sendJson(res, 404, { error: { code: "not_found", message: "Recipe not found" } });

    if (!sub && method === "GET") return sendJson(res, 200, recipeDetail(recipe));
    if (!sub && method === "PATCH") {
      const data = JSON.parse(await readBody(req)) as { visibility?: StoredRecipe["visibility"] };
      if (data.visibility) recipe.visibility = data.visibility;
      recipe.updatedAt = new Date().toISOString();
      return sendJson(res, 200, recipeSummary(recipe));
    }
    if (!sub && method === "DELETE") {
      recipes.delete(recipeId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (sub === "versions" && !subId && method === "GET") {
      return sendJson(
        res,
        200,
        recipe.versions.map((v) => ({
          id: v.id,
          version: v.version,
          name: v.name,
          createdAt: v.createdAt,
        })),
      );
    }
    if (sub === "versions" && subId && method === "GET") {
      const v = recipe.versions.find((x) => x.version === Number(subId));
      if (!v)
        return sendJson(res, 404, { error: { code: "not_found", message: "Version not found" } });
      return sendJson(res, 200, v);
    }
    if (sub === "versions" && !subId && method === "POST") {
      const data = JSON.parse(await readBody(req)) as {
        name: string;
        styleId?: string | null;
        batchSizeL: number;
        equipmentProfileId?: string | null;
        content: Record<string, unknown>;
      };
      const now = new Date().toISOString();
      const next: StoredVersion = {
        id: randomUUID(),
        version: recipe.versions.length + 1,
        name: data.name,
        beverage: recipe.beverage,
        styleId: data.styleId ?? null,
        batchSizeL: data.batchSizeL,
        equipmentProfileId: data.equipmentProfileId ?? null,
        content: data.content,
        createdAt: now,
        stats: null,
        statsError: null,
        styleFit: null,
      };
      recipe.name = data.name;
      recipe.updatedAt = now;
      recipe.versions.push(next);
      return sendJson(res, 201, next);
    }
    if (sub === "fork" && method === "POST") {
      const user = getUserForRequest(req);
      if (!user)
        return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
      const latest = recipe.versions[recipe.versions.length - 1];
      if (!latest)
        return sendJson(res, 404, { error: { code: "not_found", message: "No version" } });
      const newId = randomUUID();
      const now = new Date().toISOString();
      const forked: StoredRecipe = {
        id: newId,
        uri: `http://127.0.0.1:${PORT}/recipes/${newId}`,
        name: `${recipe.name} (fork)`,
        beverage: recipe.beverage,
        visibility: "private",
        owner: { type: "user", id: user.id },
        credit: null,
        forkedFrom: { uri: recipe.uri, recipeId: recipe.id },
        publicSharingBlocked: recipe.publicSharingBlocked,
        createdAt: now,
        updatedAt: now,
        versions: [
          {
            ...latest,
            id: randomUUID(),
            version: 1,
            name: `${recipe.name} (fork)`,
            createdAt: now,
          },
        ],
        shares: [],
      };
      recipes.set(newId, forked);
      return sendJson(res, 201, recipeDetail(forked));
    }
    if (sub === "shares" && method === "GET") {
      return sendJson(res, 200, recipe.shares);
    }
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: { code: "not_found", message: "Not found" } });
  }

  const candidate = resolve(WEB_DIR, pathname.replace(/^\/+/, ""));
  if (candidate.startsWith(WEB_DIR) && existsSync(candidate) && statSync(candidate).isFile()) {
    return serveFile(res, candidate);
  }

  return serveFile(res, join(WEB_DIR, "index.html"));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`E2E server listening on http://127.0.0.1:${PORT} (webDir=${WEB_DIR})`);
});
