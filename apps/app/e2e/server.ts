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
  units: "us" | "metric";
  disabled: boolean;
  createdAt: string;
  password: string;
}

interface StoredToken {
  id: string;
  userId: string;
  secret: string;
  kind: "session" | "app" | "personal";
  name: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
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
  owner: { type: "user" | "brewery"; id: string };
  credit: {
    sourceUrl: string | null;
    site: string | null;
    author: string | null;
    importedAt: string | null;
    license: string | null;
  } | null;
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

interface StoredBatch {
  id: string;
  uri: string;
  name: string;
  beverage: "beer" | "mead" | "wine" | "cider";
  status: string;
  visibility: "private" | "unlisted" | "server" | "public";
  owner: { type: "user" | "brewery"; id: string };
  recipe: { id: string; version: number; versionId: string };
  batchSizeL: number | null;
  equipmentProfileId: string | null;
  brewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: { status: string; changedAt: string }[];
  readings: StoredReading[];
  reminders: StoredReminder[];
}

interface StoredReading {
  id: string;
  batchId: string;
  takenAt: string;
  gravitySg: number | null;
  temperatureC: number | null;
  ph: number | null;
  brix: number | null;
  titratableAcidityGPerL: number | null;
  freeSo2MgPerL: number | null;
  source: "manual" | "device";
  note: string | null;
  createdAt: string;
}

interface StoredReminder {
  id: string;
  batchId: string;
  batchName: string;
  kind: "nutrient" | "rack" | "sulfite" | "taste" | "ready" | "custom";
  dueAt: string;
  note: string | null;
  doneAt: string | null;
  createdAt: string;
}

interface StoredNote {
  id: string;
  uri: string;
  kind: "general" | "tasting";
  body: string;
  recipeId: string | null;
  batchId: string | null;
  scores: {
    aroma: number | null;
    appearance: number | null;
    flavor: number | null;
    mouthfeel: number | null;
    overall: number | null;
    total: number | null;
  } | null;
  visibility: "private" | "unlisted" | "server" | "public";
  owner: { type: "user" | "brewery"; id: string };
  createdAt: string;
  updatedAt: string;
}

const BEER_FLOW = ["planned", "brewing", "fermenting", "conditioning", "packaged", "finished"];
const FERM_FLOW = [
  "planned",
  "primary",
  "secondary",
  "bulk_aging",
  "stabilized",
  "bottled",
  "bottle_aging",
  "finished",
];

function allowedStatusesFor(beverage: StoredBatch["beverage"], status: string): string[] {
  const flow = beverage === "beer" ? BEER_FLOW : FERM_FLOW;
  const idx = flow.indexOf(status);
  if (idx < 0) return [];
  const next = flow.slice(idx + 1);
  const back = idx > 0 ? [flow[idx - 1] as string] : [];
  return [...back, ...next];
}

function batchSummary(b: StoredBatch) {
  return {
    id: b.id,
    uri: b.uri,
    name: b.name,
    beverage: b.beverage,
    status: b.status,
    visibility: b.visibility,
    owner: b.owner,
    recipe: b.recipe,
    batchSizeL: b.batchSizeL,
    equipmentProfileId: b.equipmentProfileId,
    brewedAt: b.brewedAt,
    completedAt: b.completedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function batchDetail(b: StoredBatch) {
  return {
    ...batchSummary(b),
    statusHistory: b.statusHistory,
    allowedStatuses: allowedStatusesFor(b.beverage, b.status),
  };
}

type BreweryRole = "owner" | "brewer" | "member" | "viewer";

interface StoredBrewery {
  id: string;
  uri: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  createdAt: string;
  updatedAt: string;
  members: { userId: string; displayName: string; role: BreweryRole; joinedAt: string }[];
}

interface StoredBreweryInvite {
  id: string;
  breweryId: string;
  breweryName: string;
  role: BreweryRole;
  email: string | null;
  code: string | null;
  createdAt: string;
  expiresAt: string;
}

type QuantityUnit = "kg" | "l" | "each";

interface StoredInventoryItem {
  id: string;
  uri: string;
  owner: { type: "user" | "brewery"; id: string };
  name: string;
  catalogId: string | null;
  quantity: number;
  quantityUnit: QuantityUnit;
  lot: string | null;
  location: string | null;
  alphaAcidPct: number | null;
  purchasedOn: string | null;
  bestBefore: string | null;
  lowStockThreshold: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredReservation {
  batchId: string;
  itemId: string;
  name: string;
  quantity: number;
  unit: QuantityUnit;
  state: "reserved" | "used" | "released";
}

const users = new Map<string, StoredUser>();
const sessions = new Map<string, string>();
const tokens = new Map<string, StoredToken>();
const recipes = new Map<string, StoredRecipe>();
const batches = new Map<string, StoredBatch>();
const notes = new Map<string, StoredNote>();
const breweries = new Map<string, StoredBrewery>();
const breweryInvites = new Map<string, StoredBreweryInvite>();
const inventoryItems = new Map<string, StoredInventoryItem>();
const batchReservations: StoredReservation[] = [];
const equipmentProfiles: Record<string, unknown>[] = [];

function reservedForItem(itemId: string): number {
  return batchReservations
    .filter((r) => r.itemId === itemId && r.state === "reserved")
    .reduce((sum, r) => sum + r.quantity, 0);
}

function inventoryView(item: StoredInventoryItem) {
  const reserved = reservedForItem(item.id);
  return { ...item, reserved, available: item.quantity - reserved };
}

function sameOwner(
  a: { type: "user" | "brewery"; id: string },
  b: { type: "user" | "brewery"; id: string },
): boolean {
  return a.type === b.type && a.id === b.id;
}

function recipeLinesForBatch(b: StoredBatch) {
  const recipe = recipes.get(b.recipe.id);
  const ver = recipe?.versions.find((v) => v.version === b.recipe.version);
  const content = (ver?.content ?? {}) as {
    fermentables?: { name: string; catalogId?: string; amountKg?: number; amountL?: number }[];
    hops?: { name: string; catalogId?: string; amountKg?: number }[];
    yeasts?: {
      name: string;
      catalogId?: string;
      packs?: number;
      amountKg?: number;
      amountL?: number;
    }[];
    miscs?: {
      name: string;
      catalogId?: string;
      amountKg?: number;
      amountL?: number;
      count?: number;
    }[];
  };
  const out: { name: string; catalogId: string | null; unit: QuantityUnit; amount: number }[] = [];
  for (const f of content.fermentables ?? []) {
    if (f.amountKg && f.amountKg > 0)
      out.push({ name: f.name, catalogId: f.catalogId ?? null, unit: "kg", amount: f.amountKg });
    else if (f.amountL && f.amountL > 0)
      out.push({ name: f.name, catalogId: f.catalogId ?? null, unit: "l", amount: f.amountL });
  }
  for (const h of content.hops ?? []) {
    if (h.amountKg && h.amountKg > 0)
      out.push({ name: h.name, catalogId: h.catalogId ?? null, unit: "kg", amount: h.amountKg });
  }
  for (const y of content.yeasts ?? []) {
    if (y.packs && y.packs > 0)
      out.push({ name: y.name, catalogId: y.catalogId ?? null, unit: "each", amount: y.packs });
    else if (y.amountKg && y.amountKg > 0)
      out.push({ name: y.name, catalogId: y.catalogId ?? null, unit: "kg", amount: y.amountKg });
    else if (y.amountL && y.amountL > 0)
      out.push({ name: y.name, catalogId: y.catalogId ?? null, unit: "l", amount: y.amountL });
  }
  for (const m of content.miscs ?? []) {
    if (m.amountKg && m.amountKg > 0)
      out.push({ name: m.name, catalogId: m.catalogId ?? null, unit: "kg", amount: m.amountKg });
    else if (m.amountL && m.amountL > 0)
      out.push({ name: m.name, catalogId: m.catalogId ?? null, unit: "l", amount: m.amountL });
    else if (m.count && m.count > 0)
      out.push({ name: m.name, catalogId: m.catalogId ?? null, unit: "each", amount: m.count });
  }
  return out;
}

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
    units: user.units,
  };
}

function adminUserView(user: StoredUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    disabled: user.disabled,
    createdAt: user.createdAt,
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

  if (pathname === "/api/me" && method === "PATCH") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    const data = JSON.parse(await readBody(req)) as {
      displayName?: string;
      units?: "us" | "metric";
    };
    if (data.displayName !== undefined) {
      const trimmed = data.displayName.trim();
      if (!trimmed) {
        return sendJson(res, 400, {
          error: { code: "validation_error", message: "Display name required" },
        });
      }
      user.displayName = trimmed;
    }
    if (data.units === "us" || data.units === "metric") {
      user.units = data.units;
    }
    return sendJson(res, 200, publicUser(user));
  }

  if (pathname === "/api/me/password" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    const data = JSON.parse(await readBody(req)) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (data.currentPassword !== user.password) {
      return sendJson(res, 401, {
        error: { code: "invalid_credentials", message: "Current password is incorrect" },
      });
    }
    if (!data.newPassword || data.newPassword.length < 8) {
      return sendJson(res, 400, {
        error: { code: "validation_error", message: "Password must be at least 8 characters" },
      });
    }
    user.password = data.newPassword;
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/api/auth/tokens" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    const list = [...tokens.values()]
      .filter((t) => t.userId === user.id)
      .map(({ secret: _, userId: __, ...rest }) => rest);
    return sendJson(res, 200, list);
  }

  if (pathname === "/api/auth/tokens" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    const data = JSON.parse(await readBody(req)) as { name?: string; scopes?: string[] };
    const id = randomUUID();
    const secret = `bb_${randomBytes(16).toString("hex")}`;
    const tok: StoredToken = {
      id,
      userId: user.id,
      secret,
      kind: "personal",
      name: (data.name ?? "API Token").trim(),
      scopes: data.scopes && data.scopes.length > 0 ? data.scopes : ["read"],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    tokens.set(id, tok);
    const { secret: rawSecret, userId: _, ...rest } = tok;
    return sendJson(res, 201, { ...rest, token: rawSecret });
  }

  const tokenIdMatch = pathname.match(/^\/api\/auth\/tokens\/([^/]+)$/);
  if (tokenIdMatch && method === "DELETE") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    tokens.delete(tokenIdMatch[1] ?? "");
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/api/invites" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user?.isAdmin) {
      return sendJson(res, 403, { error: { code: "forbidden", message: "Admin required" } });
    }
    return sendJson(res, 201, {
      code: randomBytes(12).toString("hex"),
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
  }

  if (pathname === "/api/admin/users" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user?.isAdmin) {
      return sendJson(res, 403, { error: { code: "forbidden", message: "Admin required" } });
    }
    return sendJson(res, 200, [...users.values()].map(adminUserView));
  }

  const adminUserAction = pathname.match(
    /^\/api\/admin\/users\/([^/]+)\/(disable|enable|password-reset)$/,
  );
  if (adminUserAction && method === "POST") {
    const admin = getUserForRequest(req);
    if (!admin?.isAdmin) {
      return sendJson(res, 403, { error: { code: "forbidden", message: "Admin required" } });
    }
    const target = users.get(adminUserAction[1] ?? "");
    if (!target) {
      return sendJson(res, 404, { error: { code: "not_found", message: "User not found" } });
    }
    const action = adminUserAction[2];
    if (action === "disable" || action === "enable") {
      target.disabled = action === "disable";
      return sendJson(res, 200, adminUserView(target));
    }
    const resetToken = randomBytes(16).toString("hex");
    return sendJson(res, 201, {
      url: `http://127.0.0.1:${PORT}/reset-password#token=${resetToken}`,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
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
      units: "us",
      disabled: false,
      createdAt: new Date().toISOString(),
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

  // Catalog sources & attribution (P1-04)
  if (pathname === "/api/catalog/sources" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    }
    return sendJson(res, 200, {
      sources: {
        bt001: {
          name: "Brewtarget default content",
          url: "https://github.com/Brewtarget/brewtarget",
          license: "GPL-3.0",
          commit: "000000000000",
        },
        bjcpjson: {
          name: "BeerJSON bjcp-json",
          url: "https://github.com/beerjson/bjcp-json",
          license: "MIT",
          commit: "000000000000",
        },
        beerproto: {
          name: "BeerProto dataset",
          url: "https://github.com/beerproto/dataset",
          license: "MIT",
          commit: "000000000000",
        },
      },
      attribution: "# Attribution\nOpen-licensed brewing catalog data.",
    });
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

  // Recipe file & URL import preview (P1-08 / P1-09)
  if (pathname === "/api/recipes/import" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as {
      format: "beerxml" | "beerjson";
      contents: string;
    };
    const tagVal = (src: string, tag: string): string | null => {
      const m = src.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
      return m?.[1]?.trim() || null;
    };
    const blocks = (src: string, tag: string): string[] => {
      const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
      const out: string[] = [];
      for (const m of src.matchAll(re)) {
        if (m[1]) out.push(m[1]);
      }
      return out;
    };

    if (data.format === "beerjson") {
      const parsed = JSON.parse(data.contents) as {
        beerjson?: { recipes?: Array<{ name?: string; author?: string }> };
      };
      const first = parsed.beerjson?.recipes?.[0];
      if (!first) {
        return sendJson(res, 400, {
          error: { code: "validation_error", message: "Invalid BeerJSON" },
        });
      }
      return sendJson(res, 200, {
        name: first.name ?? "Imported BeerJSON Recipe",
        beverage: "beer",
        batchSizeL: 18.927,
        styleId: null,
        visibility: "private",
        ...(first.author
          ? { credit: { sourceUrl: null, author: first.author, publicSharingBlocked: false } }
          : {}),
        content: {
          schemaVersion: 1,
          efficiencyPct: 72,
          boilTimeMin: 60,
          fermentables: [],
          hops: [],
          yeasts: [],
          miscs: [],
          mash: [],
          fermentation: [],
        },
      });
    }

    const recipeBlock = blocks(data.contents, "RECIPE")[0] ?? data.contents;
    const name = tagVal(recipeBlock, "NAME") ?? "Imported Recipe";
    const brewer = tagVal(recipeBlock, "BREWER");
    const batchSizeL = Number(tagVal(recipeBlock, "BATCH_SIZE") ?? "18.927") || 18.927;
    const boilTimeMin = Number(tagVal(recipeBlock, "BOIL_TIME") ?? "60") || 60;
    const efficiencyPct = Number(tagVal(recipeBlock, "EFFICIENCY") ?? "72") || 72;

    const fermentables = blocks(recipeBlock, "FERMENTABLE").map((b) => {
      const fName = tagVal(b, "NAME") ?? "Malt";
      const matched = (SEEDED_CATALOG.fermentables ?? []).find(
        (c) => String(c.name ?? "").toLowerCase() === fName.toLowerCase(),
      );
      return {
        name: fName,
        ...(matched ? { catalogId: String(matched.id) } : {}),
        kind: (tagVal(b, "TYPE") ?? "grain").toLowerCase().includes("extract")
          ? "extract"
          : "grain",
        amountKg: Number(tagVal(b, "AMOUNT") ?? "1") || 1,
        use: "mash",
        ...(matched?.potentialSg ? { potentialSg: Number(matched.potentialSg) } : {}),
        yieldPct: Number(tagVal(b, "YIELD") ?? "75") || 75,
        colorEbc: (Number(tagVal(b, "COLOR") ?? "2") || 2) * 1.97,
      };
    });
    const hops = blocks(recipeBlock, "HOP").map((b) => ({
      name: tagVal(b, "NAME") ?? "Hop",
      amountKg: Number(tagVal(b, "AMOUNT") ?? "0.02") || 0.02,
      alphaAcidPct: Number(tagVal(b, "ALPHA") ?? "10") || 10,
      use: (tagVal(b, "USE") ?? "boil").toLowerCase().includes("dry") ? "dry_hop" : "boil",
      timeMin: Number(tagVal(b, "TIME") ?? "60") || 60,
    }));
    const yeasts = blocks(recipeBlock, "YEAST").map((b) => ({
      name: tagVal(b, "NAME") ?? "Yeast",
      form: (tagVal(b, "FORM") ?? "dry").toLowerCase() === "liquid" ? "liquid" : "dry",
      packs: 1,
      attenuationPct: Number(tagVal(b, "ATTENUATION") ?? "78") || 78,
    }));

    return sendJson(res, 200, {
      name,
      beverage: "beer",
      batchSizeL,
      styleId: null,
      visibility: "private",
      ...(brewer
        ? { credit: { sourceUrl: null, author: brewer, publicSharingBlocked: false } }
        : {}),
      content: {
        schemaVersion: 1,
        efficiencyPct,
        boilTimeMin,
        fermentables,
        hops,
        yeasts,
        miscs: [],
        mash: [],
        fermentation: [],
      },
    });
  }

  if (pathname === "/api/recipes/import-url" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as { url: string; batchSizeL?: number };
    const parsedUrl = new URL(data.url);
    return sendJson(res, 200, {
      draft: {
        name: "Imported Web Recipe",
        beverage: "beer",
        batchSizeL: data.batchSizeL ?? 18.927,
        styleId: null,
        visibility: "private",
        credit: {
          sourceUrl: data.url,
          site: parsedUrl.hostname,
          author: "Web Brewer",
          publicSharingBlocked: false,
        },
        content: {
          schemaVersion: 1,
          efficiencyPct: 72,
          boilTimeMin: 60,
          fermentables: [{ name: "Pale Malt", kind: "grain", amountKg: 4.5, use: "mash" }],
          hops: [{ name: "Columbus", amountKg: 0.02, alphaAcidPct: 16, use: "boil", timeMin: 60 }],
          yeasts: [{ name: "Safale US-05", form: "dry", packs: 1, attenuationPct: 81 }],
          miscs: [],
          mash: [],
          fermentation: [],
        },
      },
      excerpt: "Imported from public web recipe page.",
    });
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
      credit?: {
        sourceUrl: string | null;
        site?: string;
        author?: string;
        license?: string;
        publicSharingBlocked?: boolean;
      };
      breweryId?: string;
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
      owner: data.breweryId
        ? { type: "brewery", id: data.breweryId }
        : { type: "user", id: user.id },
      credit: data.credit
        ? {
            sourceUrl: data.credit.sourceUrl ?? null,
            site: data.credit.site ?? null,
            author: data.credit.author ?? null,
            importedAt: now,
            license: data.credit.license ?? null,
          }
        : null,
      forkedFrom: null,
      publicSharingBlocked: Boolean(data.credit?.publicSharingBlocked),
      createdAt: now,
      updatedAt: now,
      versions: [version],
      shares: [],
    };
    recipes.set(id, recipe);
    return sendJson(res, 201, recipeDetail(recipe));
  }

  const exportMatch = pathname.match(/^\/api\/recipes\/([^/]+)\/versions\/(\d+)\/export$/);
  if (exportMatch && method === "GET") {
    const recipeId = exportMatch[1] ?? "";
    const verNum = Number(exportMatch[2]);
    const format = url.searchParams.get("format") === "beerjson" ? "beerjson" : "beerxml";
    const recipe = recipes.get(recipeId);
    const v = recipe?.versions.find((x) => x.version === verNum);
    if (!recipe || !v) {
      return sendJson(res, 404, {
        error: { code: "not_found", message: "Recipe version not found" },
      });
    }
    const ext = format === "beerxml" ? "xml" : "json";
    const body =
      format === "beerxml"
        ? `<?xml version="1.0" encoding="UTF-8"?><RECIPES><RECIPE><NAME>${v.name}</NAME><VERSION>1</VERSION><TYPE>All Grain</TYPE><BATCH_SIZE>${v.batchSizeL}</BATCH_SIZE></RECIPE></RECIPES>`
        : JSON.stringify({
            beerjson: {
              version: 1,
              recipes: [
                {
                  name: v.name,
                  type: "all grain",
                  author: recipe.credit?.author ?? "Brewer",
                  batch_size: { value: v.batchSizeL, unit: "l" },
                },
              ],
            },
          });
    res.writeHead(200, {
      "content-type":
        format === "beerxml" ? "application/xml; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="recipe-${recipe.id}-v${v.version}.${ext}"`,
    });
    res.end(body);
    return;
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

  // Batches CRUD, status, readings, reminders
  if (pathname === "/api/batches" && method === "GET") {
    const statusFilter = url.searchParams.get("status");
    const list = [...batches.values()]
      .filter((b) => (!statusFilter ? true : b.status === statusFilter))
      .map(batchSummary);
    return sendJson(res, 200, { items: list, nextOffset: null });
  }
  if (pathname === "/api/batches" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as {
      recipeId: string;
      version?: number;
      name?: string;
      batchSizeL?: number;
      equipmentProfileId?: string | null;
      breweryId?: string;
    };
    const recipe = recipes.get(data.recipeId);
    if (!recipe)
      return sendJson(res, 404, { error: { code: "not_found", message: "Recipe not found" } });
    const ver =
      (data.version
        ? recipe.versions.find((v) => v.version === data.version)
        : recipe.versions[recipe.versions.length - 1]) ?? recipe.versions[0];
    if (!ver)
      return sendJson(res, 404, { error: { code: "not_found", message: "Version not found" } });
    const id = randomUUID();
    const now = new Date().toISOString();
    const b: StoredBatch = {
      id,
      uri: `http://127.0.0.1:${PORT}/batches/${id}`,
      name: data.name?.trim() || ver.name,
      beverage: ver.beverage,
      status: "planned",
      visibility: "private",
      owner: data.breweryId
        ? { type: "brewery", id: data.breweryId }
        : { type: "user", id: user.id },
      recipe: { id: recipe.id, version: ver.version, versionId: ver.id },
      batchSizeL: data.batchSizeL ?? ver.batchSizeL,
      equipmentProfileId: data.equipmentProfileId ?? ver.equipmentProfileId,
      brewedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      statusHistory: [{ status: "planned", changedAt: now }],
      readings: [],
      reminders: [],
    };
    batches.set(id, b);
    return sendJson(res, 201, batchDetail(b));
  }

  const batchSub = pathname.match(
    /^\/api\/batches\/([^/]+)(?:\/(status|readings|reminders|reservations|stats)(?:\/([^/]+))?)?$/,
  );
  if (batchSub) {
    const batchId = batchSub[1] ?? "";
    const sub = batchSub[2];
    const subId = batchSub[3];
    const b = batches.get(batchId);
    if (!b) return sendJson(res, 404, { error: { code: "not_found", message: "Batch not found" } });

    if (!sub && method === "GET") return sendJson(res, 200, batchDetail(b));
    if (!sub && method === "DELETE") {
      for (const r of batchReservations) {
        if (r.batchId === batchId && r.state === "reserved") r.state = "released";
      }
      batches.delete(batchId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (sub === "reservations" && method === "GET") {
      const items = batchReservations
        .filter((r) => r.batchId === batchId)
        .map(({ batchId: _, ...rest }) => rest);
      return sendJson(res, 200, { items });
    }
    if (sub === "stats" && method === "GET") {
      const overrides = batchReservations
        .filter((r) => r.batchId === batchId && r.state !== "released")
        .map((r) => {
          const item = inventoryItems.get(r.itemId);
          return item && item.alphaAcidPct != null
            ? { hop: r.name, alphaAcidPct: item.alphaAcidPct, itemId: item.id }
            : null;
        })
        .filter((x): x is { hop: string; alphaAcidPct: number; itemId: string } => x !== null);
      return sendJson(res, 200, {
        stats: null,
        statsError: null,
        alphaAcidFromInventory: overrides,
      });
    }
    if (sub === "status" && method === "POST") {
      const data = JSON.parse(await readBody(req)) as { status: string };
      const allowed = allowedStatusesFor(b.beverage, b.status);
      if (!allowed.includes(data.status)) {
        return sendJson(res, 409, {
          error: { code: "conflict", message: "Status move not allowed" },
        });
      }
      const prevStatus = b.status;
      const now = new Date().toISOString();
      b.status = data.status;
      b.updatedAt = now;
      if ((data.status === "brewing" || data.status === "primary") && !b.brewedAt) {
        b.brewedAt = now;
      }
      if (data.status === "finished" && !b.completedAt) {
        b.completedAt = now;
      }
      b.statusHistory.push({ status: data.status, changedAt: now });

      let inventory: {
        reserved: {
          itemId: string;
          name: string;
          quantity: number;
          unit: QuantityUnit;
          state: "reserved" | "used" | "released";
        }[];
        short: { name: string; catalogId: string | null; unit: QuantityUnit; short: number }[];
        used: boolean;
        released: boolean;
      } | null = null;

      if (prevStatus === "planned" && (data.status === "brewing" || data.status === "primary")) {
        const lines = recipeLinesForBatch(b);
        const ownerStock = [...inventoryItems.values()].filter((i) => sameOwner(i.owner, b.owner));
        const reserved: {
          itemId: string;
          name: string;
          quantity: number;
          unit: QuantityUnit;
          state: "reserved" | "used" | "released";
        }[] = [];
        const short: {
          name: string;
          catalogId: string | null;
          unit: QuantityUnit;
          short: number;
        }[] = [];

        for (const line of lines) {
          const sameUnit = ownerStock.filter((i) => i.quantityUnit === line.unit);
          const byCat = line.catalogId
            ? sameUnit.filter((i) => i.catalogId === line.catalogId)
            : [];
          const candidates =
            byCat.length > 0
              ? byCat
              : sameUnit.filter(
                  (i) => i.name.trim().toLowerCase() === line.name.trim().toLowerCase(),
                );
          let remaining = line.amount;
          for (const item of candidates) {
            if (remaining <= 1e-9) break;
            const avail = Math.max(0, item.quantity - reservedForItem(item.id));
            const take = Math.min(avail, remaining);
            if (take > 1e-9) {
              const entry: StoredReservation = {
                batchId: b.id,
                itemId: item.id,
                name: item.name,
                quantity: take,
                unit: item.quantityUnit,
                state: "reserved",
              };
              batchReservations.push(entry);
              reserved.push({
                itemId: entry.itemId,
                name: entry.name,
                quantity: entry.quantity,
                unit: entry.unit,
                state: entry.state,
              });
              remaining -= take;
            }
          }
          if (remaining > 1e-9) {
            short.push({
              name: line.name,
              catalogId: line.catalogId,
              unit: line.unit,
              short: remaining,
            });
          }
        }
        inventory = { reserved, short, used: false, released: false };
      } else if (data.status === "packaged" || data.status === "bottled") {
        let usedAny = false;
        for (const r of batchReservations) {
          if (r.batchId === b.id && r.state === "reserved") {
            r.state = "used";
            const item = inventoryItems.get(r.itemId);
            if (item) item.quantity = Math.max(0, item.quantity - r.quantity);
            usedAny = true;
          }
        }
        if (usedAny) inventory = { reserved: [], short: [], used: true, released: false };
      } else if (data.status === "planned") {
        let releasedAny = false;
        for (const r of batchReservations) {
          if (r.batchId === b.id && r.state === "reserved") {
            r.state = "released";
            releasedAny = true;
          }
        }
        if (releasedAny) inventory = { reserved: [], short: [], used: false, released: true };
      }

      return sendJson(res, 200, {
        batch: batchDetail(b),
        addedReminders: [],
        scheduleError: null,
        inventory,
      });
    }
    if (sub === "readings" && !subId && method === "GET") {
      const sorted = [...b.readings].sort((a, c) => Date.parse(a.takenAt) - Date.parse(c.takenAt));
      return sendJson(res, 200, sorted);
    }
    if (sub === "readings" && !subId && method === "POST") {
      const data = JSON.parse(await readBody(req)) as Partial<StoredReading>;
      const now = new Date().toISOString();
      const r: StoredReading = {
        id: randomUUID(),
        batchId: b.id,
        takenAt: data.takenAt ?? now,
        gravitySg: data.gravitySg ?? null,
        temperatureC: data.temperatureC ?? null,
        ph: data.ph ?? null,
        brix: data.brix ?? null,
        titratableAcidityGPerL: data.titratableAcidityGPerL ?? null,
        freeSo2MgPerL: data.freeSo2MgPerL ?? null,
        source: data.source ?? "manual",
        note: data.note ?? null,
        createdAt: now,
      };
      b.readings.push(r);
      return sendJson(res, 201, r);
    }
    if (sub === "readings" && subId && method === "PATCH") {
      const r = b.readings.find((x) => x.id === subId);
      if (!r)
        return sendJson(res, 404, { error: { code: "not_found", message: "Reading not found" } });
      const data = JSON.parse(await readBody(req)) as Partial<StoredReading>;
      Object.assign(r, data);
      return sendJson(res, 200, r);
    }
    if (sub === "readings" && subId && method === "DELETE") {
      b.readings = b.readings.filter((x) => x.id !== subId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (sub === "reminders" && !subId && method === "GET") {
      return sendJson(res, 200, b.reminders);
    }
    if (sub === "reminders" && !subId && method === "POST") {
      const data = JSON.parse(await readBody(req)) as {
        kind: StoredReminder["kind"];
        dueAt: string;
        note?: string;
      };
      const now = new Date().toISOString();
      const rem: StoredReminder = {
        id: randomUUID(),
        batchId: b.id,
        batchName: b.name,
        kind: data.kind,
        dueAt: data.dueAt,
        note: data.note ?? null,
        doneAt: null,
        createdAt: now,
      };
      b.reminders.push(rem);
      return sendJson(res, 201, rem);
    }
  }

  const reminderDoneMatch = pathname.match(/^\/api\/reminders\/([^/]+)\/done$/);
  if (reminderDoneMatch && method === "POST") {
    const remId = reminderDoneMatch[1] ?? "";
    for (const b of batches.values()) {
      const found = b.reminders.find((r) => r.id === remId);
      if (found) {
        found.doneAt = found.doneAt ?? new Date().toISOString();
        return sendJson(res, 200, found);
      }
    }
    return sendJson(res, 404, { error: { code: "not_found", message: "Reminder not found" } });
  }

  // Notes CRUD
  if (pathname === "/api/notes" && method === "GET") {
    const batchIdFilter = url.searchParams.get("batchId");
    const recipeIdFilter = url.searchParams.get("recipeId");
    const list = [...notes.values()]
      .filter((n) => (!batchIdFilter ? true : n.batchId === batchIdFilter))
      .filter((n) => (!recipeIdFilter ? true : n.recipeId === recipeIdFilter))
      .reverse();
    return sendJson(res, 200, { items: list, nextOffset: null });
  }
  if (pathname === "/api/notes" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as {
      kind?: "general" | "tasting";
      body: string;
      recipeId?: string;
      batchId?: string;
      scores?: {
        aroma?: number | null;
        appearance?: number | null;
        flavor?: number | null;
        mouthfeel?: number | null;
        overall?: number | null;
      };
    };
    const id = randomUUID();
    const now = new Date().toISOString();
    const kind = data.kind ?? "general";
    let scores: StoredNote["scores"] = null;
    if (kind === "tasting" && data.scores) {
      const vals = [
        data.scores.aroma ?? null,
        data.scores.appearance ?? null,
        data.scores.flavor ?? null,
        data.scores.mouthfeel ?? null,
        data.scores.overall ?? null,
      ];
      const numeric = vals.filter((v): v is number => typeof v === "number");
      scores = {
        aroma: data.scores.aroma ?? null,
        appearance: data.scores.appearance ?? null,
        flavor: data.scores.flavor ?? null,
        mouthfeel: data.scores.mouthfeel ?? null,
        overall: data.scores.overall ?? null,
        total: numeric.length > 0 ? numeric.reduce((a, c) => a + c, 0) : null,
      };
    }
    const noteObj: StoredNote = {
      id,
      uri: `http://127.0.0.1:${PORT}/notes/${id}`,
      kind,
      body: data.body.trim(),
      recipeId: data.recipeId ?? null,
      batchId: data.batchId ?? null,
      scores,
      visibility: "private",
      owner: { type: "user", id: user.id },
      createdAt: now,
      updatedAt: now,
    };
    notes.set(id, noteObj);
    return sendJson(res, 201, noteObj);
  }
  const noteIdMatch = pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (noteIdMatch && method === "DELETE") {
    notes.delete(noteIdMatch[1] ?? "");
    res.writeHead(204);
    res.end();
    return;
  }

  // Move recipe/batch to brewery (P2-03)
  const moveMatch = pathname.match(/^\/api\/(recipes|batches)\/([^/]+)\/move$/);
  if (moveMatch && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as { breweryId: string };
    const targetOwner = { type: "brewery" as const, id: data.breweryId };
    if (moveMatch[1] === "recipes") {
      const r = recipes.get(moveMatch[2] ?? "");
      if (!r)
        return sendJson(res, 404, { error: { code: "not_found", message: "Recipe not found" } });
      r.owner = targetOwner;
      return sendJson(res, 200, { owner: targetOwner });
    }
    const b = batches.get(moveMatch[2] ?? "");
    if (!b) return sendJson(res, 404, { error: { code: "not_found", message: "Batch not found" } });
    b.owner = targetOwner;
    return sendJson(res, 200, { owner: targetOwner });
  }

  // Inventory CRUD, low-stock, and shopping list (P2-04)
  const scopeOwner = (user: StoredUser, breweryId: string | null) =>
    breweryId
      ? { type: "brewery" as const, id: breweryId }
      : { type: "user" as const, id: user.id };

  if (pathname === "/api/inventory" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const owner = scopeOwner(user, url.searchParams.get("breweryId"));
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const items = [...inventoryItems.values()]
      .filter((i) => sameOwner(i.owner, owner))
      .filter((i) => {
        if (!q) return true;
        return [i.name, i.catalogId ?? "", i.lot ?? "", i.location ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .map(inventoryView);
    return sendJson(res, 200, { items, nextOffset: null });
  }

  if (pathname === "/api/inventory" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as {
      name: string;
      catalogId?: string | null;
      quantity: number;
      quantityUnit: QuantityUnit;
      breweryId?: string;
      lot?: string | null;
      location?: string | null;
      alphaAcidPct?: number | null;
      purchasedOn?: string | null;
      bestBefore?: string | null;
      lowStockThreshold?: number | null;
      notes?: string | null;
    };
    const id = randomUUID();
    const now = new Date().toISOString();
    const item: StoredInventoryItem = {
      id,
      uri: `http://127.0.0.1:${PORT}/inventory/${id}`,
      owner: scopeOwner(user, data.breweryId ?? null),
      name: data.name.trim(),
      catalogId: data.catalogId ?? null,
      quantity: data.quantity,
      quantityUnit: data.quantityUnit,
      lot: data.lot ?? null,
      location: data.location ?? null,
      alphaAcidPct: data.alphaAcidPct ?? null,
      purchasedOn: data.purchasedOn ?? null,
      bestBefore: data.bestBefore ?? null,
      lowStockThreshold: data.lowStockThreshold ?? null,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    inventoryItems.set(id, item);
    return sendJson(res, 201, inventoryView(item));
  }

  if (pathname === "/api/inventory/low-stock" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const owner = scopeOwner(user, url.searchParams.get("breweryId"));
    const items = [...inventoryItems.values()]
      .filter((i) => sameOwner(i.owner, owner))
      .map(inventoryView)
      .filter((i) => i.lowStockThreshold != null && i.available < i.lowStockThreshold);
    return sendJson(res, 200, { items });
  }

  if (pathname === "/api/inventory/shopping-list" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const owner = scopeOwner(user, url.searchParams.get("breweryId"));
    const stock = [...inventoryItems.values()]
      .filter((i) => sameOwner(i.owner, owner))
      .map(inventoryView);
    const lowStock = stock.filter(
      (i) => i.lowStockThreshold != null && i.available < i.lowStockThreshold,
    );
    const availById = new Map(stock.map((i) => [i.id, i.available]));
    const shortMap = new Map<
      string,
      {
        name: string;
        catalogId: string | null;
        unit: QuantityUnit;
        short: number;
        batches: { id: string; name: string }[];
      }
    >();
    for (const b of batches.values()) {
      if (b.status !== "planned" || !sameOwner(b.owner, owner)) continue;
      for (const line of recipeLinesForBatch(b)) {
        const sameUnit = stock.filter((i) => i.quantityUnit === line.unit);
        const byCat = line.catalogId ? sameUnit.filter((i) => i.catalogId === line.catalogId) : [];
        const candidates =
          byCat.length > 0
            ? byCat
            : sameUnit.filter(
                (i) => i.name.trim().toLowerCase() === line.name.trim().toLowerCase(),
              );
        let remaining = line.amount;
        for (const item of candidates) {
          const avail = Math.max(0, availById.get(item.id) ?? 0);
          const take = Math.min(avail, remaining);
          if (take > 1e-9) {
            availById.set(item.id, avail - take);
            remaining -= take;
          }
        }
        if (remaining > 1e-9) {
          const key = `${line.catalogId ?? line.name.trim().toLowerCase()}|${line.unit}`;
          const entry = shortMap.get(key) ?? {
            name: line.name,
            catalogId: line.catalogId,
            unit: line.unit,
            short: 0,
            batches: [],
          };
          entry.short += remaining;
          if (!entry.batches.some((x) => x.id === b.id)) {
            entry.batches.push({ id: b.id, name: b.name });
          }
          shortMap.set(key, entry);
        }
      }
    }
    return sendJson(res, 200, { short: [...shortMap.values()], lowStock });
  }

  const invIdMatch = pathname.match(/^\/api\/inventory\/([^/]+)$/);
  if (invIdMatch) {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const invId = invIdMatch[1] ?? "";
    const item = inventoryItems.get(invId);
    if (!item)
      return sendJson(res, 404, {
        error: { code: "not_found", message: "Inventory item not found" },
      });
    if (method === "GET") return sendJson(res, 200, inventoryView(item));
    if (method === "PATCH") {
      const patch = JSON.parse(await readBody(req)) as Partial<StoredInventoryItem>;
      Object.assign(item, patch, { updatedAt: new Date().toISOString() });
      return sendJson(res, 200, inventoryView(item));
    }
    if (method === "DELETE") {
      inventoryItems.delete(invId);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // Breweries & invites (P2-03)
  const breweryView = (b: StoredBrewery, role: BreweryRole) => ({
    id: b.id,
    uri: b.uri,
    name: b.name,
    description: b.description,
    city: b.city,
    state: b.state,
    role,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  });
  const breweryDetailView = (b: StoredBrewery, role: BreweryRole) => ({
    ...breweryView(b, role),
    members: b.members,
  });

  if (pathname === "/api/breweries" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const items = [...breweries.values()]
      .map((b) => {
        const m = b.members.find((x) => x.userId === user.id);
        return m ? breweryView(b, m.role) : null;
      })
      .filter((x): x is ReturnType<typeof breweryView> => x !== null);
    return sendJson(res, 200, { items });
  }

  if (pathname === "/api/breweries" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as {
      name?: string;
      description?: string | null;
      city?: string | null;
      state?: string | null;
    };
    const name = data.name?.trim();
    if (!name) {
      return sendJson(res, 400, {
        error: { code: "validation_error", message: "Brewery name required" },
      });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const b: StoredBrewery = {
      id,
      uri: `http://127.0.0.1:${PORT}/breweries/${id}`,
      name,
      description: data.description?.trim() || null,
      city: data.city?.trim() || null,
      state: data.state?.trim() || null,
      createdAt: now,
      updatedAt: now,
      members: [{ userId: user.id, displayName: user.displayName, role: "owner", joinedAt: now }],
    };
    breweries.set(id, b);
    return sendJson(res, 201, breweryDetailView(b, "owner"));
  }

  if (pathname === "/api/brewery-invites" && method === "GET") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const items = [...breweryInvites.values()]
      .filter((inv) => inv.email?.toLowerCase() === user.email.toLowerCase())
      .map((inv) => ({
        id: inv.id,
        brewery: { id: inv.breweryId, name: inv.breweryName },
        role: inv.role,
        email: inv.email,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
      }));
    return sendJson(res, 200, { items });
  }

  if (pathname === "/api/brewery-invites/accept" && method === "POST") {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const data = JSON.parse(await readBody(req)) as { id?: string; code?: string };
    const found = [...breweryInvites.values()].find((inv) =>
      data.code ? inv.code === data.code : inv.id === data.id,
    );
    if (!found) {
      return sendJson(res, 404, {
        error: { code: "invalid_invite", message: "That invite is not valid or has expired" },
      });
    }
    const b = breweries.get(found.breweryId);
    if (!b)
      return sendJson(res, 404, { error: { code: "not_found", message: "Brewery not found" } });
    if (b.members.some((m) => m.userId === user.id)) {
      return sendJson(res, 409, {
        error: { code: "already_member", message: "You are already a member" },
      });
    }
    b.members.push({
      userId: user.id,
      displayName: user.displayName,
      role: found.role,
      joinedAt: new Date().toISOString(),
    });
    breweryInvites.delete(found.id);
    return sendJson(res, 200, breweryDetailView(b, found.role));
  }

  const declineInviteMatch = pathname.match(/^\/api\/brewery-invites\/([^/]+)$/);
  if (declineInviteMatch && method === "DELETE") {
    breweryInvites.delete(declineInviteMatch[1] ?? "");
    res.writeHead(204);
    res.end();
    return;
  }

  const brewerySub = pathname.match(
    /^\/api\/breweries\/([^/]+)(?:\/(invites|members|transfer)(?:\/([^/]+)(?:\/(role))?)?)?$/,
  );
  if (brewerySub) {
    const user = getUserForRequest(req);
    if (!user)
      return sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in first" } });
    const bId = brewerySub[1] ?? "";
    const sub = brewerySub[2];
    const subId = brewerySub[3];
    const subAction = brewerySub[4];
    const b = breweries.get(bId);
    const me = b?.members.find((m) => m.userId === user.id);
    if (!b || !me) {
      return sendJson(res, 404, { error: { code: "not_found", message: "Brewery not found" } });
    }
    if (!sub && method === "GET") return sendJson(res, 200, breweryDetailView(b, me.role));
    if (!sub && method === "PATCH") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      const data = JSON.parse(await readBody(req)) as Partial<
        Pick<StoredBrewery, "name" | "description" | "city" | "state">
      >;
      if (data.name !== undefined) b.name = data.name.trim();
      if (data.description !== undefined) b.description = data.description;
      if (data.city !== undefined) b.city = data.city;
      if (data.state !== undefined) b.state = data.state;
      b.updatedAt = new Date().toISOString();
      return sendJson(res, 200, breweryDetailView(b, me.role));
    }
    if (!sub && method === "DELETE") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      breweries.delete(bId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (sub === "invites" && !subId && method === "GET") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      const items = [...breweryInvites.values()]
        .filter((inv) => inv.breweryId === bId)
        .map((inv) => ({
          id: inv.id,
          brewery: { id: b.id, name: b.name },
          role: inv.role,
          email: inv.email,
          createdAt: inv.createdAt,
          expiresAt: inv.expiresAt,
        }));
      return sendJson(res, 200, { items });
    }
    if (sub === "invites" && !subId && method === "POST") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      const data = JSON.parse(await readBody(req)) as { role: BreweryRole; email?: string };
      const now = new Date();
      const inv: StoredBreweryInvite = {
        id: randomUUID(),
        breweryId: b.id,
        breweryName: b.name,
        role: data.role,
        email: data.email?.trim().toLowerCase() ?? null,
        code: data.email ? null : randomBytes(12).toString("hex"),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      };
      breweryInvites.set(inv.id, inv);
      return sendJson(res, 201, {
        id: inv.id,
        brewery: { id: b.id, name: b.name },
        role: inv.role,
        email: inv.email,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        ...(inv.code ? { code: inv.code } : {}),
      });
    }
    if (sub === "invites" && subId && method === "DELETE") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      breweryInvites.delete(subId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (sub === "members" && subId && subAction === "role" && method === "PUT") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      const data = JSON.parse(await readBody(req)) as { role: BreweryRole };
      const target = b.members.find((m) => m.userId === subId);
      if (!target)
        return sendJson(res, 404, { error: { code: "not_found", message: "Member not found" } });
      target.role = data.role;
      return sendJson(res, 200, breweryDetailView(b, subId === user.id ? data.role : me.role));
    }
    if (sub === "members" && subId && !subAction && method === "DELETE") {
      if (subId !== user.id && me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      b.members = b.members.filter((m) => m.userId !== subId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (sub === "transfer" && method === "POST") {
      if (me.role !== "owner")
        return sendJson(res, 403, { error: { code: "forbidden", message: "Owners only" } });
      const data = JSON.parse(await readBody(req)) as { userId: string };
      const target = b.members.find((m) => m.userId === data.userId);
      if (!target)
        return sendJson(res, 404, { error: { code: "not_found", message: "Member not found" } });
      target.role = "owner";
      me.role = "brewer";
      return sendJson(res, 200, breweryDetailView(b, "brewer"));
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
