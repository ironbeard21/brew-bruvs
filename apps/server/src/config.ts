// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads and validates environment variables. Nothing else in the server reads process.env.
import { resolve } from "node:path";
import { z } from "zod";

export const DEFAULT_SOURCE_URL = "https://github.com/ironbeard21/brew-bruvs";

const optional = z
  .string()
  .optional()
  .transform((v) => v || undefined);

const schema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // Folder holding the static web build of the app. Unset: the server only serves the API.
    WEB_DIR: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1),
    APP_DATABASE_URL: z.string().min(1).optional(),
    BASE_URL: z.url().transform((v) => v.replace(/\/+$/, "")),
    SOURCE_URL: z.url({ protocol: /^https?$/ }).default(DEFAULT_SOURCE_URL),
    SIGNUP_MODE: z.enum(["open", "invite"]).default("invite"),
    // true behind a reverse proxy, so sign-in rate limits see the real client address.
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    OIDC_ISSUER: optional,
    OIDC_CLIENT_ID: optional,
    OIDC_CLIENT_SECRET: optional,
  })
  .refine(
    (e) => {
      const set = [e.OIDC_ISSUER, e.OIDC_CLIENT_ID, e.OIDC_CLIENT_SECRET].filter(Boolean).length;
      return set === 0 || set === 3;
    },
    {
      path: ["OIDC_ISSUER"],
      message: "set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET together",
    },
  );

export interface Config {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Absolute path, resolved from the working directory. */
  webDir: string | undefined;
  databaseUrl: string;
  /** The server's own login, without BYPASSRLS. Unset: connect with DATABASE_URL, then SET ROLE. */
  appDatabaseUrl: string | undefined;
  /** Public address without a trailing slash. */
  baseUrl: string;
  sourceUrl: string;
  signupMode: "open" | "invite";
  /** Take the client address from X-Forwarded-For (set by the reverse proxy). */
  trustProxy: boolean;
  oidc: { issuer: string; clientId: string; clientSecret: string } | undefined;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  const e = result.data;
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    webDir: e.WEB_DIR ? resolve(e.WEB_DIR) : undefined,
    databaseUrl: e.DATABASE_URL,
    appDatabaseUrl: e.APP_DATABASE_URL,
    baseUrl: e.BASE_URL,
    sourceUrl: e.SOURCE_URL,
    signupMode: e.SIGNUP_MODE,
    trustProxy: e.TRUST_PROXY,
    oidc:
      e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET
        ? { issuer: e.OIDC_ISSUER, clientId: e.OIDC_CLIENT_ID, clientSecret: e.OIDC_CLIENT_SECRET }
        : undefined,
  };
}
