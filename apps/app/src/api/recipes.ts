// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type Recipe = components["schemas"]["Recipe"];
export type RecipeDetail = components["schemas"]["RecipeDetail"];
export type RecipeVersion = components["schemas"]["RecipeVersion"];
export type RecipeVersionSummary = components["schemas"]["RecipeVersionSummary"];
export type RecipeContent = components["schemas"]["RecipeContent"];
export type RecipeVersionInput = components["schemas"]["RecipeVersionInput"];
export type CreateRecipeInput = components["schemas"]["CreateRecipe"];
export type RecipePatchInput = components["schemas"]["RecipePatch"];
export type ScaledRecipe = components["schemas"]["ScaledRecipe"];
export type Share = components["schemas"]["Share"];
export type ShareInput = components["schemas"]["ShareInput"];
export type EquipmentProfile = components["schemas"]["EquipmentProfile"];
export type EquipmentProfileInput = components["schemas"]["EquipmentProfileInput"];
export type Beverage = Recipe["beverage"];
export type Visibility = Recipe["visibility"];

export async function fetchRecipes(
  serverUrl: string,
  token: string | null,
  opts: { q?: string; mine?: boolean } = {},
  customFetch?: typeof fetch,
): Promise<Recipe[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const trimmed = opts.q?.trim();
  const { data, error } = await client.GET("/api/recipes", {
    credentials: "include",
    params: {
      query: {
        ...(trimmed ? { q: trimmed } : {}),
        ...(opts.mine ? { mine: "true" } : {}),
        limit: 100,
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load recipes."));
  }
  return data.items;
}

export async function fetchRecipeDetail(
  serverUrl: string,
  token: string | null,
  id: string,
  customFetch?: typeof fetch,
): Promise<RecipeDetail> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/recipes/{id}", {
    credentials: "include",
    params: { path: { id } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load recipe."));
  }
  return data;
}

export async function fetchRecipeVersions(
  serverUrl: string,
  token: string | null,
  id: string,
  customFetch?: typeof fetch,
): Promise<RecipeVersionSummary[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/recipes/{id}/versions", {
    credentials: "include",
    params: { path: { id } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load version history."));
  }
  return data;
}

export async function fetchRecipeVersion(
  serverUrl: string,
  token: string | null,
  id: string,
  version: number,
  customFetch?: typeof fetch,
): Promise<RecipeVersion> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/recipes/{id}/versions/{version}", {
    credentials: "include",
    params: { path: { id, version } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, `Could not load version ${version}.`));
  }
  return data;
}

export async function fetchRecipeShares(
  serverUrl: string,
  token: string | null,
  id: string,
  customFetch?: typeof fetch,
): Promise<Share[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/recipes/{id}/shares", {
    credentials: "include",
    params: { path: { id } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load recipe shares."));
  }
  return data;
}

export async function fetchEquipmentProfiles(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<EquipmentProfile[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/equipment-profiles", {
    credentials: "include",
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load equipment profiles."));
  }
  return data;
}

export function useRecipes(
  serverUrl: string | null,
  token: string | null,
  opts: { q?: string; mine?: boolean; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["recipes", serverUrl, opts.q?.trim() ?? "", Boolean(opts.mine)],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchRecipes(serverUrl, token, opts, customFetch);
    },
  });
}

export function useRecipeDetail(
  serverUrl: string | null,
  token: string | null,
  id: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["recipe-detail", serverUrl, id],
    enabled: Boolean(serverUrl && id),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !id) throw new Error("Missing server or recipe id");
      return fetchRecipeDetail(serverUrl, token, id, customFetch);
    },
  });
}

export function useRecipeVersions(
  serverUrl: string | null,
  token: string | null,
  id: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["recipe-versions", serverUrl, id],
    enabled: Boolean(serverUrl && id),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !id) throw new Error("Missing server or recipe id");
      return fetchRecipeVersions(serverUrl, token, id, customFetch);
    },
  });
}

export function useRecipeShares(
  serverUrl: string | null,
  token: string | null,
  id: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["recipe-shares", serverUrl, id],
    enabled: Boolean(serverUrl && id) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl || !id) throw new Error("Missing server or recipe id");
      return fetchRecipeShares(serverUrl, token, id, customFetch);
    },
  });
}

export function useEquipmentProfiles(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["equipment-profiles", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchEquipmentProfiles(serverUrl, token, customFetch);
    },
  });
}

export function useCreateRecipe(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRecipeInput): Promise<RecipeDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/recipes", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create recipe."));
      }
      return data;
    },
    onSuccess: async (detail) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["recipe-detail", serverUrl, detail.id], detail);
      await queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] });
    },
  });
}

export function useSaveRecipeVersion(
  serverUrl: string | null,
  token: string | null,
  recipeId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecipeVersionInput): Promise<RecipeVersion> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/recipes/{id}/versions", {
        credentials: "include",
        params: { path: { id: recipeId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not save recipe version."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl, recipeId] }),
        queryClient.invalidateQueries({ queryKey: ["recipe-versions", serverUrl, recipeId] }),
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
      ]);
    },
  });
}

export function usePatchRecipe(
  serverUrl: string | null,
  token: string | null,
  recipeId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecipePatchInput): Promise<Recipe> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PATCH("/api/recipes/{id}", {
        credentials: "include",
        params: { path: { id: recipeId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not update recipe visibility."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl, recipeId] }),
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
      ]);
    },
  });
}

export function useDeleteRecipe(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recipeId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/recipes/{id}", {
        credentials: "include",
        params: { path: { id: recipeId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete recipe."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] });
    },
  });
}

export function useForkRecipe(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { recipeId: string; name?: string }): Promise<RecipeDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/recipes/{id}/fork", {
        credentials: "include",
        params: { path: { id: input.recipeId } },
        body: input.name ? { name: input.name } : {},
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not fork recipe."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] });
    },
  });
}

export function useScaleRecipe(
  serverUrl: string | null,
  token: string | null,
  recipeId: string,
  customFetch?: typeof fetch,
) {
  return useMutation({
    mutationFn: async (equipmentProfileId: string): Promise<ScaledRecipe> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/recipes/{id}/scale", {
        credentials: "include",
        params: { path: { id: recipeId } },
        body: { equipmentProfileId },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not scale recipe."));
      }
      return data;
    },
  });
}

export function useAddRecipeShare(
  serverUrl: string | null,
  token: string | null,
  recipeId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ShareInput): Promise<Share> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/recipes/{id}/shares", {
        credentials: "include",
        params: { path: { id: recipeId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not share recipe."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["recipe-shares", serverUrl, recipeId] });
    },
  });
}

export function useRemoveRecipeShare(
  serverUrl: string | null,
  token: string | null,
  recipeId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/recipes/{id}/shares/{shareId}", {
        credentials: "include",
        params: { path: { id: recipeId, shareId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not revoke share."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["recipe-shares", serverUrl, recipeId] });
    },
  });
}

export function useCreateEquipmentProfile(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EquipmentProfileInput): Promise<EquipmentProfile> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/equipment-profiles", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create equipment profile."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["equipment-profiles", serverUrl] });
    },
  });
}
