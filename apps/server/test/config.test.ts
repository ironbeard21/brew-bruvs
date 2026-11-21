// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it("uses defaults when nothing is set", () => {
    expect(loadConfig({})).toEqual({ port: 8080, logLevel: "info", webDir: undefined });
  });

  it("reads and coerces values", () => {
    expect(loadConfig({ PORT: "3000", LOG_LEVEL: "debug", WEB_DIR: "/srv/web" })).toEqual({
      port: 3000,
      logLevel: "debug",
      webDir: "/srv/web",
    });
  });

  it("resolves a relative WEB_DIR against the working directory", () => {
    expect(loadConfig({ WEB_DIR: "web" }).webDir).toBe(resolve("web"));
  });

  it("rejects bad values with the variable name in the message", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});
