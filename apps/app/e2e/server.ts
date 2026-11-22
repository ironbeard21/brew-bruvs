// SPDX-License-Identifier: AGPL-3.0-or-later
// Lightweight local E2E server serving the built Expo web bundle (dist/) alongside
// the P0-11 auth OpenAPI contract so Playwright tests run without an external database.
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

const users = new Map<string, StoredUser>();
const sessions = new Map<string, string>(); // secret -> userId

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
    const raw = await readBody(req);
    const data = JSON.parse(raw) as {
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
    const raw = await readBody(req);
    const data = JSON.parse(raw) as {
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
    res.writeHead(204, {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`,
    });
    res.end();
    return;
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
