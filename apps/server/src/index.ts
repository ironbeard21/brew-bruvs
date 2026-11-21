// SPDX-License-Identifier: AGPL-3.0-or-later
// Start-up: config, logger, routes. Database and jobs join in later tasks.
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const app = createApp({ logger, webDir: config.webDir });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info("server listening", { port: info.port, webDir: config.webDir ?? null });
});
