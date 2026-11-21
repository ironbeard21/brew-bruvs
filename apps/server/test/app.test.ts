// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { createApp, OPENAPI_INFO } from "../src/app.ts";
import { createLogger } from "../src/logger.ts";

function setup(webDir?: string) {
  const lines: string[] = [];
  const app = createApp({ logger: createLogger("debug", (l) => lines.push(l)), webDir });
  return { app, logs: () => lines.map((l) => JSON.parse(l)) };
}

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await setup().app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("logs the request without the query string", async () => {
    const { app, logs } = setup();
    await app.request("/healthz?token=secret");
    expect(logs()).toEqual([
      expect.objectContaining({ msg: "request", path: "/healthz", status: 200 }),
    ]);
    expect(JSON.stringify(logs())).not.toContain("secret");
  });
});

describe("GET /api/openapi.json", () => {
  it("serves the spec with the health route and the error schema", async () => {
    const res = await setup().app.request("/api/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/healthz"]).toBeDefined();
    expect(doc.components.schemas.Error).toBeDefined();
  });

  it("matches the committed packages/api-contract/openapi.json (run `pnpm api:generate`)", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../../../packages/api-contract/openapi.json", import.meta.url), "utf8"),
    );
    expect(setup().app.getOpenAPI31Document(OPENAPI_INFO)).toEqual(committed);
  });
});

describe("error format", () => {
  it("unknown routes return 404 { error: { code, message } }", async () => {
    const res = await setup().app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  });

  it("unhandled errors return 500 without leaking the message, and are logged", async () => {
    const { app, logs } = setup();
    app.get("/boom", () => {
      throw new Error("db password is hunter2");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
    expect(logs()).toContainEqual(expect.objectContaining({ level: "error", path: "/boom" }));
  });

  it("HTTP exceptions keep their status", async () => {
    const { app } = setup();
    app.get("/teapot", () => {
      throw new HTTPException(418, { message: "short and stout" });
    });
    const res = await app.request("/teapot");
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: { code: "http_error", message: "short and stout" } });
  });

  it("invalid input returns 400 validation_error naming the field", async () => {
    const { app } = setup();
    const route = createRoute({
      method: "get",
      path: "/echo",
      request: { query: z.object({ n: z.coerce.number().int() }) },
      responses: { 200: { description: "ok" } },
    });
    app.openapi(route, (c) => c.json({ n: c.req.valid("query").n }, 200));

    const res = await app.request("/echo?n=abc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("n:");
  });
});

describe("static web build", () => {
  const webDir = mkdtempSync(join(tmpdir(), "brew-web-"));
  writeFileSync(join(webDir, "index.html"), "<h1>app</h1>");
  writeFileSync(join(webDir, "app.js"), "console.log(1)");

  it("serves files from the configured folder", async () => {
    const { app } = setup(webDir);
    expect(await (await app.request("/")).text()).toBe("<h1>app</h1>");
    expect(await (await app.request("/app.js")).text()).toBe("console.log(1)");
  });

  it("falls back to index.html for client-side routes", async () => {
    const res = await setup(webDir).app.request("/recipes/123");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>app</h1>");
  });

  it("never serves the web build for /api paths", async () => {
    const res = await setup(webDir).app.request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  });

  it("serves nothing but the API when no folder is configured", async () => {
    expect((await setup().app.request("/")).status).toBe(404);
  });
});
