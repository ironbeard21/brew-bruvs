// SPDX-License-Identifier: AGPL-3.0-or-later
// Start-up: config, logger, database, routes. Jobs join in later tasks.
import { createDb } from "@brew-bruvs/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createOidc } from "./auth/oidc.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createAuthService } from "./services/auth.ts";
import { createBatchService } from "./services/batches.ts";
import { createCatalogService } from "./services/catalog.ts";
import { createEquipmentProfileService } from "./services/equipment-profiles.ts";
import { createNoteService } from "./services/notes.ts";
import { createRecipeFileService } from "./services/recipe-files.ts";
import { createRecipeService } from "./services/recipes.ts";

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const { db } = createDb(config.databaseUrl);
const profiles = createEquipmentProfileService(db, { baseUrl: config.baseUrl });
const app = createApp({
  logger,
  webDir: config.webDir,
  sourceUrl: config.sourceUrl,
  catalog: createCatalogService(db),
  profiles,
  recipes: createRecipeService(db, { baseUrl: config.baseUrl, profiles }),
  recipeFiles: createRecipeFileService(db),
  batches: createBatchService(db, { baseUrl: config.baseUrl, profiles }),
  notes: createNoteService(db, { baseUrl: config.baseUrl }),
  auth: {
    auth: createAuthService(db, { baseUrl: config.baseUrl, signupMode: config.signupMode }),
    oidc:
      config.oidc &&
      createOidc({ ...config.oidc, redirectUri: `${config.baseUrl}/api/auth/oidc/callback` }),
    baseUrl: config.baseUrl,
    signupMode: config.signupMode,
    trustProxy: config.trustProxy,
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
