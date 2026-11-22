// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the Hono app: API routes, OpenAPI document, static web build, error format.
import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { type AppEnv, sessionMiddleware } from "./auth/middleware.ts";
import { RecipeContent } from "./contracts/recipe-content.ts";
import { ApiError, ErrorSchema, errorBody } from "./errors.ts";
import type { Logger } from "./logger.ts";
import { type AuthRouteDeps, registerAuthRoutes } from "./routes/auth.ts";
import { registerHealthRoutes } from "./routes/health.ts";

export const OPENAPI_PATH = "/api/openapi.json";

export const OPENAPI_INFO = {
  openapi: "3.1.0",
  info: {
    title: "Brew-Bruvs API",
    version: "0.1.0",
    license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
  },
};

export interface AppDeps {
  logger: Logger;
  /** Absolute path to the static web build; undefined serves the API only. */
  webDir: string | undefined;
  auth: AuthRouteDeps;
}

export function createApp({ logger, webDir, auth }: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const message = result.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        return c.json(errorBody("validation_error", message), 400);
      }
    },
  });

  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    // Path only, never the query string: it may carry tokens.
    logger.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    });
  });

  app.openAPIRegistry.register("Error", ErrorSchema);
  // Not used by a route yet (recipes arrive in P1-05); registered so the contract publishes it.
  app.openAPIRegistry.register("RecipeContent", RecipeContent);
  app.use("/api/*", sessionMiddleware(auth.auth));
  registerHealthRoutes(app);
  registerAuthRoutes(app, auth);
  app.doc31(OPENAPI_PATH, OPENAPI_INFO);

  if (webDir) {
    const isApi = (path: string) => path === "/api" || path.startsWith("/api/");
    app.use("*", async (c, next) =>
      isApi(c.req.path) ? next() : serveStatic({ root: webDir })(c, next),
    );
    // Client-side routes: unknown non-API GETs get the app's index.html.
    app.get("*", async (c, next) =>
      isApi(c.req.path) ? next() : serveStatic({ root: webDir, path: "index.html" })(c, next),
    );
  }

  app.notFound((c) => c.json(errorBody("not_found", "Not found"), 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    if (err instanceof HTTPException) {
      return c.json(errorBody("http_error", err.message || "Request failed"), err.status);
    }
    logger.error("unhandled error", { path: c.req.path, error: err.message });
    return c.json(errorBody("internal_error", "Internal server error"), 500);
  });

  return app;
}
