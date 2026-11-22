// SPDX-License-Identifier: AGPL-3.0-or-later
// Start-up: config, logger, database, routes. Jobs join in later tasks.
import { createDb } from "@brew-bruvs/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createOidc } from "./auth/oidc.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createAuthService } from "./services/auth.ts";

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const { db } = createDb(config.databaseUrl);
const app = createApp({
  logger,
  webDir: config.webDir,
  auth: {
    auth: createAuthService(db, { baseUrl: config.baseUrl, signupMode: config.signupMode }),
    oidc:
      config.oidc &&
      createOidc({ ...config.oidc, redirectUri: `${config.baseUrl}/api/auth/oidc/callback` }),
    baseUrl: config.baseUrl,
    signupMode: config.signupMode,
  },
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info("server listening", {
    port: info.port,
    webDir: config.webDir ?? null,
    signupMode: config.signupMode,
    oidc: Boolean(config.oidc),
  });
});
