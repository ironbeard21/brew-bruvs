// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type Share = components["schemas"]["Share"];
export type ShareInput = components["schemas"]["ShareInput"];
export type Visibility = components["schemas"]["Recipe"]["visibility"];
export type VisibilityResult = components["schemas"]["VisibilityResult"];

export type ShareableResourceType =
  | "recipe"
  | "batch"
  | "note"
  | "inventory_item"
  | "equipment_item"
  | "equipment_profile";

export const RESOURCE_LABELS: Record<ShareableResourceType, string> = {
  recipe: "recipe",
  batch: "batch",
  note: "note",
  inventory_item: "inventory item",
  equipment_item: "equipment item",
  equipment_profile: "equipment profile",
};

export async function fetchResourceShares(
  serverUrl: string,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  customFetch?: typeof fetch,
): Promise<Share[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const opts = { credentials: "include" as const, params: { path: { id } } };
  let res: { data?: Share[]; error?: unknown };
  switch (resourceType) {
    case "recipe":
      res = await client.GET("/api/recipes/{id}/shares", opts);
      break;
    case "batch":
      res = await client.GET("/api/batches/{id}/shares", opts);
      break;
    case "note":
      res = await client.GET("/api/notes/{id}/shares", opts);
      break;
    case "inventory_item":
      res = await client.GET("/api/inventory/{id}/shares", opts);
      break;
    case "equipment_item":
      res = await client.GET("/api/equipment/{id}/shares", opts);
      break;
    case "equipment_profile":
      res = await client.GET("/api/equipment-profiles/{id}/shares", opts);
      break;
  }
  if (res.error || !res.data) {
    throw new Error(
      formatApiError(res.error, `Could not load ${RESOURCE_LABELS[resourceType]} shares.`),
    );
  }
  return res.data;
}

export async function updateResourceVisibility(
  serverUrl: string,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  visibility: Visibility,
  confirmPublic = false,
  customFetch?: typeof fetch,
): Promise<VisibilityResult> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  if (resourceType === "recipe") {
    const { data, error } = await client.PATCH("/api/recipes/{id}", {
      credentials: "include",
      params: { path: { id } },
      body: { visibility, confirmPublic },
    });
    if (error || !data) {
      throw new Error(formatApiError(error, "Could not update recipe visibility."));
    }
    return { id: data.id, visibility: data.visibility };
  }
  const opts = {
    credentials: "include" as const,
    params: { path: { id } },
    body: { visibility },
  };
  let res: { data?: VisibilityResult; error?: unknown };
  switch (resourceType) {
    case "batch":
      res = await client.PUT("/api/batches/{id}/visibility", opts);
      break;
    case "note":
      res = await client.PUT("/api/notes/{id}/visibility", opts);
      break;
    case "inventory_item":
      res = await client.PUT("/api/inventory/{id}/visibility", opts);
      break;
    case "equipment_item":
      res = await client.PUT("/api/equipment/{id}/visibility", opts);
      break;
    case "equipment_profile":
      res = await client.PUT("/api/equipment-profiles/{id}/visibility", opts);
      break;
  }
  if (res.error || !res.data) {
    throw new Error(
      formatApiError(res.error, `Could not update ${RESOURCE_LABELS[resourceType]} visibility.`),
    );
  }
  return res.data;
}

export async function addResourceShare(
  serverUrl: string,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  input: ShareInput,
  customFetch?: typeof fetch,
): Promise<Share> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const opts = {
    credentials: "include" as const,
    params: { path: { id } },
    body: input,
  };
  let res: { data?: Share; error?: unknown };
  switch (resourceType) {
    case "recipe":
      res = await client.POST("/api/recipes/{id}/shares", opts);
      break;
    case "batch":
      res = await client.POST("/api/batches/{id}/shares", opts);
      break;
    case "note":
      res = await client.POST("/api/notes/{id}/shares", opts);
      break;
    case "inventory_item":
      res = await client.POST("/api/inventory/{id}/shares", opts);
      break;
    case "equipment_item":
      res = await client.POST("/api/equipment/{id}/shares", opts);
      break;
    case "equipment_profile":
      res = await client.POST("/api/equipment-profiles/{id}/shares", opts);
      break;
  }
  if (res.error || !res.data) {
    throw new Error(formatApiError(res.error, `Could not share ${RESOURCE_LABELS[resourceType]}.`));
  }
  return res.data;
}

export async function removeResourceShare(
  serverUrl: string,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  shareId: string,
  customFetch?: typeof fetch,
): Promise<void> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const opts = {
    credentials: "include" as const,
    params: { path: { id, shareId } },
  };
  let res: { error?: unknown };
  switch (resourceType) {
    case "recipe":
      res = await client.DELETE("/api/recipes/{id}/shares/{shareId}", opts);
      break;
    case "batch":
      res = await client.DELETE("/api/batches/{id}/shares/{shareId}", opts);
      break;
    case "note":
      res = await client.DELETE("/api/notes/{id}/shares/{shareId}", opts);
      break;
    case "inventory_item":
      res = await client.DELETE("/api/inventory/{id}/shares/{shareId}", opts);
      break;
    case "equipment_item":
      res = await client.DELETE("/api/equipment/{id}/shares/{shareId}", opts);
      break;
    case "equipment_profile":
      res = await client.DELETE("/api/equipment-profiles/{id}/shares/{shareId}", opts);
      break;
  }
  if (res.error) {
    throw new Error(formatApiError(res.error, "Could not remove share."));
  }
}

export function sharesQueryKey(
  serverUrl: string | null,
  resourceType: ShareableResourceType,
  id: string | null,
) {
  return resourceType === "recipe"
    ? (["recipe-shares", serverUrl, id] as const)
    : (["resource-shares", serverUrl, resourceType, id] as const);
}

export function visibilityCacheKey(
  serverUrl: string | null,
  resourceType: ShareableResourceType,
  id: string | null,
) {
  return ["resource-visibility", serverUrl, resourceType, id] as const;
}

export function useResourceShares(
  serverUrl: string | null,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: sharesQueryKey(serverUrl, resourceType, id),
    enabled: Boolean(serverUrl && id) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl || !id) throw new Error("Missing server or resource id");
      return fetchResourceShares(serverUrl, token, resourceType, id, customFetch);
    },
  });
}

export function useSetResourceVisibility(
  serverUrl: string | null,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      visibility: Visibility;
      confirmPublic?: boolean;
    }): Promise<VisibilityResult> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return updateResourceVisibility(
        serverUrl,
        token,
        resourceType,
        id,
        input.visibility,
        input.confirmPublic ?? false,
        customFetch,
      );
    },
    onSuccess: async (result) => {
      if (!serverUrl) return;
      queryClient.setQueryData(visibilityCacheKey(serverUrl, resourceType, id), result.visibility);
      const invalidations: Promise<void>[] = [];
      switch (resourceType) {
        case "recipe":
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl, id] }),
            queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
          );
          break;
        case "batch":
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["batch-detail", serverUrl, id] }),
            queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
            queryClient.invalidateQueries({ queryKey: ["my-batches", serverUrl] }),
          );
          break;
        case "note":
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["batch-notes", serverUrl] }),
          );
          break;
        case "inventory_item":
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
            queryClient.invalidateQueries({ queryKey: ["low-stock", serverUrl] }),
          );
          break;
        case "equipment_item":
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["equipment-items", serverUrl] }),
          );
          break;
        case "equipment_profile":
          invalidations.push(
            queryClient.invalidateQueries({ queryKey: ["equipment-profiles", serverUrl] }),
          );
          break;
      }
      await Promise.all(invalidations);
    },
  });
}

export function useAddResourceShare(
  serverUrl: string | null,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ShareInput): Promise<Share> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return addResourceShare(serverUrl, token, resourceType, id, input, customFetch);
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({
        queryKey: sharesQueryKey(serverUrl, resourceType, id),
      });
    },
  });
}

export function useRemoveResourceShare(
  serverUrl: string | null,
  token: string | null,
  resourceType: ShareableResourceType,
  id: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (shareId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      return removeResourceShare(serverUrl, token, resourceType, id, shareId, customFetch);
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({
        queryKey: sharesQueryKey(serverUrl, resourceType, id),
      });
    },
  });
}
