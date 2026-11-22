// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const required = { DATABASE_URL: "postgres://db/brew", BASE_URL: "https://brew.example/" };

describe("loadConfig", () => {
  it("uses defaults when only the required values are set", () => {
    expect(loadConfig(required)).toEqual({
      port: 8080,
      logLevel: "info",
      webDir: undefined,
      databaseUrl: "postgres://db/brew",
      baseUrl: "https://brew.example",
      signupMode: "invite",
      oidc: undefined,
    });
  });

  it("reads and coerces values", () => {
    const config = loadConfig({
      ...required,
      PORT: "3000",
      LOG_LEVEL: "debug",
      WEB_DIR: "/srv/web",
      SIGNUP_MODE: "open",
      OIDC_ISSUER: "https://id.example",
      OIDC_CLIENT_ID: "brew",
      OIDC_CLIENT_SECRET: "s3cret",
    });
    expect(config).toMatchObject({
      port: 3000,
      logLevel: "debug",
      webDir: "/srv/web",
      signupMode: "open",
    });
    expect(config.oidc).toEqual({
      issuer: "https://id.example",
      clientId: "brew",
      clientSecret: "s3cret",
    });
  });

  it("resolves a relative WEB_DIR against the working directory", () => {
    expect(loadConfig({ ...required, WEB_DIR: "web" }).webDir).toBe(resolve("web"));
  });

  it("rejects bad values with the variable name in the message", () => {
    expect(() => loadConfig({ ...required, PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...required, PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...required, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig({ ...required, SIGNUP_MODE: "closed" })).toThrow(/SIGNUP_MODE/);
    expect(() => loadConfig({ BASE_URL: required.BASE_URL })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: required.DATABASE_URL })).toThrow(/BASE_URL/);
  });

  it("needs all three OIDC values or none", () => {
    expect(() => loadConfig({ ...required, OIDC_ISSUER: "https://id.example" })).toThrow(/OIDC/);
  });
});
