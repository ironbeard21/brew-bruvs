// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads and validates environment variables. Nothing else in the server reads process.env.
import { resolve } from "node:path";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Folder holding the static web build of the app. Unset: the server only serves the API.
  WEB_DIR: z.string().min(1).optional(),
});

export interface Config {
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Absolute path, resolved from the working directory. */
  webDir: string | undefined;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  const { PORT, LOG_LEVEL, WEB_DIR } = result.data;
  return { port: PORT, logLevel: LOG_LEVEL, webDir: WEB_DIR ? resolve(WEB_DIR) : undefined };
}
