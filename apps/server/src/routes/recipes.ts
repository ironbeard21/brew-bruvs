// SPDX-License-Identifier: AGPL-3.0-or-later
// Recipes, versions, visibility, shares, forks and scaling; equipment profiles.
// Reads allow anonymous visitors (public and unlisted recipes); everything else needs a session.
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import {
  CreateRecipe,
  EquipmentProfile,
  EquipmentProfileInput,
  EquipmentProfilePatch,
  ForkInput,
  Recipe,
  RecipeDetail,
  RecipePage,
  RecipePatch,
  RecipeVersion,
  RecipeVersionInput,
  RecipeVersionSummary,
  ScaledRecipe,
  ScaleInput,
  Share,
  ShareInput,
} from "../contracts/recipes.ts";
import { errorResponses } from "../errors.ts";
import type { EquipmentProfileService } from "../services/equipment-profiles.ts";
import type { RecipeService } from "../services/recipes.ts";
import { body, json } from "./auth.ts";

const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
const recipe = { tags: ["recipes"], security } satisfies Pick<RouteConfig, "tags" | "security">;
const profile = { tags: ["equipment"], security } satisfies Pick<RouteConfig, "tags" | "security">;
const id = z.object({ id: z.uuid() });
const noContent = { description: "Done" };

const parseDecimal = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;

const routes = {
  list: createRoute({
    ...recipe,
    method: "get",
    path: "/api/recipes",
    operationId: "listRecipes",
    summary: "Recipes you can read, newest first; search by name. Unlisted ones are never listed",
    request: {
      query: z.strictObject({
        q: z.string().trim().min(1).max(200).optional(),
        mine: z
          .enum(["true", "false"])
          .default("false")
          .transform((v) => v === "true")
          .openapi({ description: "Only recipes you own" }),
        limit: z.preprocess(parseDecimal, z.int().min(1).max(100)).default(25),
        offset: z.preprocess(parseDecimal, z.int().nonnegative().max(2_147_483_647)).default(0),
      }),
    },
    responses: { 200: json(RecipePage, "Recipes"), ...errorResponses(400, 401) },
  }),
  create: createRoute({
    ...recipe,
    method: "post",
    path: "/api/recipes",
    operationId: "createRecipe",
    summary: "Create a recipe with its first version",
    request: body(CreateRecipe),
    responses: { 201: json(RecipeDetail, "Created"), ...errorResponses(400, 401) },
  }),
  get: createRoute({
    ...recipe,
    method: "get",
    path: "/api/recipes/{id}",
    operationId: "getRecipe",
    summary: "A recipe with its latest version and stats",
    request: { params: id },
    responses: { 200: json(RecipeDetail, "Recipe"), ...errorResponses(400, 404) },
  }),
  patch: createRoute({
    ...recipe,
    method: "patch",
    path: "/api/recipes/{id}",
    operationId: "setRecipeVisibility",
    summary: "Change who can see a recipe",
    request: { params: id, ...body(RecipePatch) },
    responses: { 200: json(Recipe, "Updated"), ...errorResponses(400, 401, 403, 404, 409) },
  }),
  delete: createRoute({
    ...recipe,
    method: "delete",
    path: "/api/recipes/{id}",
    operationId: "deleteRecipe",
    summary: "Delete a recipe and all its versions (refused while batches use it)",
    request: { params: id },
    responses: { 204: noContent, ...errorResponses(400, 401, 403, 404, 409) },
  }),
  versions: createRoute({
    ...recipe,
    method: "get",
    path: "/api/recipes/{id}/versions",
    operationId: "listRecipeVersions",
    summary: "Every saved version, newest first",
    request: { params: id },
    responses: {
      200: json(z.array(RecipeVersionSummary), "Versions"),
      ...errorResponses(400, 404),
    },
  }),
  saveVersion: createRoute({
    ...recipe,
    method: "post",
    path: "/api/recipes/{id}/versions",
    operationId: "saveRecipeVersion",
    summary: "Save changes as a new version; earlier versions never change",
    request: { params: id, ...body(RecipeVersionInput) },
    responses: { 201: json(RecipeVersion, "Saved"), ...errorResponses(400, 401, 403, 404) },
  }),
  version: createRoute({
    ...recipe,
    method: "get",
    path: "/api/recipes/{id}/versions/{version}",
    operationId: "getRecipeVersion",
    summary: "One version with its stats",
    request: {
      params: z.object({ id: z.uuid(), version: z.preprocess(parseDecimal, z.int().positive()) }),
    },
    responses: { 200: json(RecipeVersion, "Version"), ...errorResponses(400, 404) },
  }),
  fork: createRoute({
    ...recipe,
    method: "post",
    path: "/api/recipes/{id}/fork",
    operationId: "forkRecipe",
    summary: "Copy a recipe you can read into your own, with a permanent forked-from credit",
    request: { params: id, ...body(ForkInput) },
    responses: { 201: json(RecipeDetail, "Forked"), ...errorResponses(400, 401, 404) },
  }),
  scale: createRoute({
    ...recipe,
    method: "post",
    path: "/api/recipes/{id}/scale",
    operationId: "scaleRecipe",
    summary: "Scale a version to an equipment profile; returns a draft and saves nothing",
    request: { params: id, ...body(ScaleInput) },
    responses: { 200: json(ScaledRecipe, "Scaled draft"), ...errorResponses(400, 401, 404) },
  }),
  shares: createRoute({
    ...recipe,
    method: "get",
    path: "/api/recipes/{id}/shares",
    operationId: "listRecipeShares",
    summary: "Who a recipe is shared with",
    request: { params: id },
    responses: { 200: json(z.array(Share), "Shares"), ...errorResponses(400, 401, 403, 404) },
  }),
  share: createRoute({
    ...recipe,
    method: "post",
    path: "/api/recipes/{id}/shares",
    operationId: "shareRecipe",
    summary: "Share with a user or brewery; sharing again changes the level",
    request: { params: id, ...body(ShareInput) },
    responses: { 201: json(Share, "Shared"), ...errorResponses(400, 401, 403, 404) },
  }),
  unshare: createRoute({
    ...recipe,
    method: "delete",
    path: "/api/recipes/{id}/shares/{shareId}",
    operationId: "unshareRecipe",
    summary: "Stop sharing",
    request: { params: z.object({ id: z.uuid(), shareId: z.uuid() }) },
    responses: { 204: noContent, ...errorResponses(400, 401, 403, 404) },
  }),

  listProfiles: createRoute({
    ...profile,
    method: "get",
    path: "/api/equipment-profiles",
    operationId: "listEquipmentProfiles",
    summary: "Your equipment profiles",
    responses: { 200: json(z.array(EquipmentProfile), "Profiles"), ...errorResponses(401) },
  }),
  createProfile: createRoute({
    ...profile,
    method: "post",
    path: "/api/equipment-profiles",
    operationId: "createEquipmentProfile",
    summary: "Add an equipment profile",
    request: body(EquipmentProfileInput),
    responses: { 201: json(EquipmentProfile, "Created"), ...errorResponses(400, 401) },
  }),
  getProfile: createRoute({
    ...profile,
    method: "get",
    path: "/api/equipment-profiles/{id}",
    operationId: "getEquipmentProfile",
    summary: "One equipment profile",
    request: { params: id },
    responses: { 200: json(EquipmentProfile, "Profile"), ...errorResponses(400, 404) },
  }),
  updateProfile: createRoute({
    ...profile,
    method: "patch",
    path: "/api/equipment-profiles/{id}",
    operationId: "updateEquipmentProfile",
    summary: "Change an equipment profile; null clears a value",
    request: { params: id, ...body(EquipmentProfilePatch) },
    responses: { 200: json(EquipmentProfile, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
  deleteProfile: createRoute({
    ...profile,
    method: "delete",
    path: "/api/equipment-profiles/{id}",
    operationId: "deleteEquipmentProfile",
    summary: "Delete an equipment profile; versions and batches that used it keep their numbers",
    request: { params: id },
    responses: { 204: noContent, ...errorResponses(400, 401, 403, 404) },
  }),
};

const viewer = (c: Context<AppEnv>) => c.get("session")?.user ?? null;

export function registerRecipeRoutes(
  app: OpenAPIHono<AppEnv>,
  deps: { recipes: RecipeService; profiles: EquipmentProfileService },
) {
  const { recipes, profiles } = deps;

  app.openapi(routes.list, async (c) =>
    c.json(await recipes.list(viewer(c), c.req.valid("query")), 200),
  );
  app.openapi(routes.create, async (c) =>
    c.json(await recipes.create(viewer(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.get, async (c) =>
    c.json(await recipes.get(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.patch, async (c) =>
    c.json(
      await recipes.setVisibility(viewer(c), c.req.valid("param").id, c.req.valid("json")),
      200,
    ),
  );
  app.openapi(routes.delete, async (c) => {
    await recipes.remove(viewer(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.openapi(routes.versions, async (c) =>
    c.json(await recipes.versions(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.saveVersion, async (c) =>
    c.json(await recipes.saveVersion(viewer(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(routes.version, async (c) => {
    const { id: recipeId, version } = c.req.valid("param");
    return c.json(await recipes.version(viewer(c), recipeId, version), 200);
  });
  app.openapi(routes.fork, async (c) =>
    c.json(await recipes.fork(viewer(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(routes.scale, async (c) =>
    c.json(await recipes.scale(viewer(c), c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(routes.shares, async (c) =>
    c.json(await recipes.listShares(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.share, async (c) =>
    c.json(await recipes.share(viewer(c), c.req.valid("param").id, c.req.valid("json")), 201),
  );
  app.openapi(routes.unshare, async (c) => {
    const { id: recipeId, shareId } = c.req.valid("param");
    await recipes.unshare(viewer(c), recipeId, shareId);
    return c.body(null, 204);
  });

  app.openapi(routes.listProfiles, async (c) => c.json(await profiles.list(viewer(c)), 200));
  app.openapi(routes.createProfile, async (c) =>
    c.json(await profiles.create(viewer(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.getProfile, async (c) =>
    c.json(await profiles.get(viewer(c), c.req.valid("param").id), 200),
  );
  app.openapi(routes.updateProfile, async (c) =>
    c.json(await profiles.update(viewer(c), c.req.valid("param").id, c.req.valid("json")), 200),
  );
  app.openapi(routes.deleteProfile, async (c) => {
    await profiles.remove(viewer(c), c.req.valid("param").id);
    return c.body(null, 204);
  });
}
