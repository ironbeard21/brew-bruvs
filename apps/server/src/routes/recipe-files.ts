// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AppEnv, requireSession } from "../auth/middleware.ts";
import { ImportedRecipeDraft, RecipeFileFormat } from "../contracts/recipe-file.ts";
import { errorBody, errorResponses } from "../errors.ts";
import { exportBeerJson } from "../importers/beerjson.ts";
import { exportBeerXml } from "../importers/beerxml.ts";
import type { RecipeFileService } from "../services/recipe-files.ts";
import type { RecipeService } from "../services/recipes.ts";
import { body, json } from "./auth.ts";
import { parseDecimal } from "./recipes.ts";

const tags = ["recipes"];
const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
const maxFileLength = 8 * 1024 * 1024;
const requireImportSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireSession(c);
  await next();
};

const importRoute = createRoute({
  tags,
  security,
  method: "post",
  path: "/api/recipes/import",
  operationId: "importRecipeFile",
  summary: "Parse one recipe file into a private draft",
  middleware: [
    requireImportSession,
    bodyLimit({
      maxSize: maxFileLength * 2,
      onError: (c) =>
        c.json(errorBody("request_too_large", "Recipe file request is too large"), 413),
    }),
  ],
  request: body(
    z.strictObject({
      format: RecipeFileFormat,
      contents: z.string().min(1).max(maxFileLength),
    }),
  ),
  responses: {
    200: json(ImportedRecipeDraft, "Draft recipe"),
    ...errorResponses(400, 401, 403, 413),
  },
});

const importUrlRoute = createRoute({
  tags,
  security,
  method: "post",
  path: "/api/recipes/import-url",
  operationId: "importRecipeUrl",
  summary: "Read one public recipe page into a private draft",
  middleware: [
    requireImportSession,
    bodyLimit({
      maxSize: 8 * 1024,
      onError: (c) =>
        c.json(errorBody("request_too_large", "Recipe URL request is too large"), 413),
    }),
  ],
  request: body(
    z.strictObject({
      url: z.url({ protocol: /^https?$/ }).max(2_000),
      batchSizeL: z.number().positive().max(100_000).optional().openapi({
        description: "Batch volume in litres for a page without a usable recipe yield",
      }),
    }),
  ),
  responses: {
    200: json(
      z.object({ draft: ImportedRecipeDraft, excerpt: z.string().max(240) }),
      "Draft recipe",
    ),
    ...errorResponses(400, 401, 403, 413),
  },
});

const exportRoute = createRoute({
  tags,
  security: [...security, {}],
  method: "get",
  path: "/api/recipes/{id}/versions/{version}/export",
  operationId: "exportRecipeVersion",
  summary: "Download a recipe version in BeerXML or BeerJSON",
  request: {
    params: z.object({ id: z.uuid(), version: z.preprocess(parseDecimal, z.int().positive()) }),
    query: z.strictObject({ format: RecipeFileFormat }),
  },
  responses: {
    200: {
      description: "Downloaded recipe file",
      headers: { "Content-Disposition": { schema: { type: "string" } } },
      content: {
        "application/xml": { schema: z.string() },
        "application/json": {
          schema: z.object({
            beerjson: z.object({
              version: z.literal(1),
              recipes: z.array(z.record(z.string(), z.unknown())),
            }),
          }),
        },
      },
    },
    ...errorResponses(400, 404),
  },
});

export function registerRecipeFileRoutes(
  app: OpenAPIHono<AppEnv>,
  recipes: RecipeService,
  files: RecipeFileService,
) {
  app.openapi(importRoute, async (c) => {
    const { format, contents } = c.req.valid("json");
    return c.json(await files.preview(c.get("session")?.user ?? null, format, contents), 200);
  });
  app.openapi(importUrlRoute, async (c) => {
    const { url, batchSizeL } = c.req.valid("json");
    return c.json(await files.previewUrl(c.get("session")?.user ?? null, url, batchSizeL), 200);
  });
  app.openapi(exportRoute, async (c) => {
    const { id, version } = c.req.valid("param");
    const { format } = c.req.valid("query");
    const { style, ...recipe } = await recipes.versionForExport(
      c.get("session")?.user ?? null,
      id,
      version,
    );
    const isXml = format === "beerxml";
    return new Response(isXml ? exportBeerXml(recipe, style) : exportBeerJson(recipe, style), {
      headers: {
        "Content-Type": isXml
          ? "application/xml; charset=utf-8"
          : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="recipe-${id}-v${version}.${isXml ? "xml" : "json"}"`,
      },
    });
  });
}
