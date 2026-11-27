// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type BreweryRole = components["schemas"]["BreweryRole"];
export type Brewery = components["schemas"]["Brewery"];
export type BreweryMember = components["schemas"]["BreweryMember"];
export type BreweryDetail = components["schemas"]["BreweryDetail"];
export type BreweryInput = components["schemas"]["BreweryInput"];
export type BreweryPatch = components["schemas"]["BreweryPatch"];
export type BreweryInvite = components["schemas"]["BreweryInvite"];
export type BreweryInviteInput = components["schemas"]["BreweryInviteInput"];
export type AcceptBreweryInviteInput = components["schemas"]["AcceptBreweryInvite"];
export type ResourceOwner = components["schemas"]["Owner"];

export async function fetchBreweries(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<Brewery[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/breweries", {
    credentials: "include",
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load breweries."));
  }
  return data.items;
}

export async function fetchBreweryDetail(
  serverUrl: string,
  token: string | null,
  id: string,
  customFetch?: typeof fetch,
): Promise<BreweryDetail> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/breweries/{id}", {
    credentials: "include",
    params: { path: { id } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load brewery."));
  }
  return data;
}

export async function fetchBreweryInvites(
  serverUrl: string,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
): Promise<BreweryInvite[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/breweries/{id}/invites", {
    credentials: "include",
    params: { path: { id: breweryId } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load brewery invites."));
  }
  return data.items;
}

export async function fetchMyBreweryInvites(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<BreweryInvite[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/brewery-invites", {
    credentials: "include",
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load pending invites."));
  }
  return data.items;
}

// ── React Query hooks ────────────────────────────────────────────────

export function useBreweries(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["breweries", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchBreweries(serverUrl, token, customFetch);
    },
  });
}

export function useBreweryDetail(
  serverUrl: string | null,
  token: string | null,
  breweryId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["brewery-detail", serverUrl, breweryId],
    enabled: Boolean(serverUrl && breweryId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !breweryId) throw new Error("Missing server or brewery id");
      return fetchBreweryDetail(serverUrl, token, breweryId, customFetch);
    },
  });
}

export function useBreweryInvites(
  serverUrl: string | null,
  token: string | null,
  breweryId: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["brewery-invites", serverUrl, breweryId],
    enabled: Boolean(serverUrl && breweryId) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl || !breweryId) throw new Error("Missing server or brewery id");
      return fetchBreweryInvites(serverUrl, token, breweryId, customFetch);
    },
  });
}

export function useMyBreweryInvites(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["my-brewery-invites", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchMyBreweryInvites(serverUrl, token, customFetch);
    },
  });
}

export function useCreateBrewery(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BreweryInput): Promise<BreweryDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/breweries", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create brewery."));
      }
      return data;
    },
    onSuccess: async (detail) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["brewery-detail", serverUrl, detail.id], detail);
      await queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] });
    },
  });
}

export function useUpdateBrewery(
  serverUrl: string | null,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BreweryPatch): Promise<BreweryDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PATCH("/api/breweries/{id}", {
        credentials: "include",
        params: { path: { id: breweryId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not update brewery."));
      }
      return data;
    },
    onSuccess: async (detail) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["brewery-detail", serverUrl, breweryId], detail);
      await queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] });
    },
  });
}

export function useDeleteBrewery(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (breweryId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/breweries/{id}", {
        credentials: "include",
        params: { path: { id: breweryId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete brewery."));
      }
    },
    onSuccess: async (_data, breweryId) => {
      if (!serverUrl) return;
      queryClient.removeQueries({ queryKey: ["brewery-detail", serverUrl, breweryId] });
      await queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] });
    },
  });
}

export function useSetBreweryRole(
  serverUrl: string | null,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role: BreweryRole }): Promise<BreweryDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PUT("/api/breweries/{id}/members/{userId}/role", {
        credentials: "include",
        params: { path: { id: breweryId, userId: input.userId } },
        body: { role: input.role },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not change member role."));
      }
      return data;
    },
    onSuccess: async (detail) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["brewery-detail", serverUrl, breweryId], detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-detail", serverUrl] }),
      ]);
    },
  });
}

export function useRemoveBreweryMember(
  serverUrl: string | null,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/breweries/{id}/members/{userId}", {
        credentials: "include",
        params: { path: { id: breweryId, userId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not remove member."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["brewery-detail", serverUrl, breweryId] }),
        queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-detail", serverUrl] }),
      ]);
    },
  });
}

export function useTransferBrewery(
  serverUrl: string | null,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<BreweryDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/breweries/{id}/transfer", {
        credentials: "include",
        params: { path: { id: breweryId } },
        body: { userId },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not transfer ownership."));
      }
      return data;
    },
    onSuccess: async (detail) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["brewery-detail", serverUrl, breweryId], detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["brewery-invites", serverUrl, breweryId] }),
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-detail", serverUrl] }),
      ]);
    },
  });
}

export function useInviteToBrewery(
  serverUrl: string | null,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BreweryInviteInput): Promise<BreweryInvite> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/breweries/{id}/invites", {
        credentials: "include",
        params: { path: { id: breweryId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create brewery invite."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({
        queryKey: ["brewery-invites", serverUrl, breweryId],
      });
    },
  });
}

export function useRevokeBreweryInvite(
  serverUrl: string | null,
  token: string | null,
  breweryId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/breweries/{id}/invites/{inviteId}", {
        credentials: "include",
        params: { path: { id: breweryId, inviteId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not revoke invite."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({
        queryKey: ["brewery-invites", serverUrl, breweryId],
      });
    },
  });
}

export function useAcceptBreweryInvite(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AcceptBreweryInviteInput): Promise<BreweryDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/brewery-invites/accept", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not accept invite."));
      }
      return data;
    },
    onSuccess: async (detail) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["brewery-detail", serverUrl, detail.id], detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["breweries", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["my-brewery-invites", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-detail", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["equipment-items", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["brewery-activity", serverUrl, detail.id] }),
      ]);
    },
  });
}

export function useDeclineBreweryInvite(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/brewery-invites/{id}", {
        credentials: "include",
        params: { path: { id: inviteId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not decline invite."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["my-brewery-invites", serverUrl] });
    },
  });
}

export function useMoveRecipeToBrewery(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { recipeId: string; breweryId: string }): Promise<ResourceOwner> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/recipes/{id}/move", {
        credentials: "include",
        params: { path: { id: input.recipeId } },
        body: { breweryId: input.breweryId },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not move recipe to brewery."));
      }
      return data.owner;
    },
    onSuccess: async (_owner, input) => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recipe-detail", serverUrl, input.recipeId] }),
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
      ]);
    },
  });
}

export function useMoveBatchToBrewery(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; breweryId: string }): Promise<ResourceOwner> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/batches/{id}/move", {
        credentials: "include",
        params: { path: { id: input.batchId } },
        body: { breweryId: input.breweryId },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not move batch to brewery."));
      }
      return data.owner;
    },
    onSuccess: async (_owner, input) => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["batch-detail", serverUrl, input.batchId] }),
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["my-batches", serverUrl] }),
      ]);
    },
  });
}
