// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type InventoryItem = components["schemas"]["InventoryItem"];
export type QuantityUnit = components["schemas"]["QuantityUnit"];
export type CreateInventoryItemInput = components["schemas"]["CreateInventoryItem"];
export type InventoryItemPatch = components["schemas"]["InventoryItemPatch"];
export type InventoryChange = NonNullable<components["schemas"]["InventoryChange"]>;
export type Reservation = components["schemas"]["Reservation"];
export type ShoppingList = components["schemas"]["ShoppingList"];
export type BatchStats = components["schemas"]["BatchStats"];

const MAX_INVENTORY_PAGES = 100;

export async function fetchInventory(
  serverUrl: string,
  token: string | null,
  opts: { breweryId?: string | null; q?: string; limit?: number } = {},
  customFetch?: typeof fetch,
): Promise<InventoryItem[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const trimmed = opts.q?.trim();
  const pageSize = opts.limit ?? 100;
  const allItems: InventoryItem[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
    const { data, error } = await client.GET("/api/inventory", {
      credentials: "include",
      params: {
        query: {
          ...(opts.breweryId ? { breweryId: opts.breweryId } : {}),
          ...(trimmed ? { q: trimmed } : {}),
          limit: pageSize,
          offset,
        },
      },
    });
    if (error || !data) {
      throw new Error(formatApiError(error, "Could not load inventory."));
    }
    allItems.push(...data.items);
    if (data.nextOffset == null || data.nextOffset <= offset || data.items.length === 0) {
      break;
    }
    offset = data.nextOffset;
  }

  return allItems;
}

export async function fetchLowStock(
  serverUrl: string,
  token: string | null,
  breweryId?: string | null,
  customFetch?: typeof fetch,
): Promise<InventoryItem[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/inventory/low-stock", {
    credentials: "include",
    params: {
      query: {
        ...(breweryId ? { breweryId } : {}),
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load low-stock items."));
  }
  return data.items;
}

export async function fetchShoppingList(
  serverUrl: string,
  token: string | null,
  breweryId?: string | null,
  customFetch?: typeof fetch,
): Promise<ShoppingList> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/inventory/shopping-list", {
    credentials: "include",
    params: {
      query: {
        ...(breweryId ? { breweryId } : {}),
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load shopping list."));
  }
  return data;
}

export async function fetchBatchReservations(
  serverUrl: string,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
): Promise<Reservation[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches/{id}/reservations", {
    credentials: "include",
    params: { path: { id: batchId } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load batch reservations."));
  }
  return data.items;
}

export async function fetchBatchStats(
  serverUrl: string,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
): Promise<BatchStats> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches/{id}/stats", {
    credentials: "include",
    params: { path: { id: batchId } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load batch stats."));
  }
  return data;
}

// ── React Query hooks ────────────────────────────────────────────────

export function useInventory(
  serverUrl: string | null,
  token: string | null,
  opts: { breweryId?: string | null; q?: string; enabled?: boolean; limit?: number } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["inventory", serverUrl, opts.breweryId ?? "me", opts.q?.trim() ?? ""],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchInventory(serverUrl, token, opts, customFetch);
    },
  });
}

export function useLowStock(
  serverUrl: string | null,
  token: string | null,
  opts: { breweryId?: string | null; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["low-stock", serverUrl, opts.breweryId ?? "me"],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchLowStock(serverUrl, token, opts.breweryId, customFetch);
    },
  });
}

export function useShoppingList(
  serverUrl: string | null,
  token: string | null,
  opts: { breweryId?: string | null; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["shopping-list", serverUrl, opts.breweryId ?? "me"],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchShoppingList(serverUrl, token, opts.breweryId, customFetch);
    },
  });
}

export function useBatchReservations(
  serverUrl: string | null,
  token: string | null,
  batchId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batch-reservations", serverUrl, batchId],
    enabled: Boolean(serverUrl && batchId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !batchId) throw new Error("Missing server or batch id");
      return fetchBatchReservations(serverUrl, token, batchId, customFetch);
    },
  });
}

export function useBatchStats(
  serverUrl: string | null,
  token: string | null,
  batchId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batch-stats", serverUrl, batchId],
    enabled: Boolean(serverUrl && batchId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !batchId) throw new Error("Missing server or batch id");
      return fetchBatchStats(serverUrl, token, batchId, customFetch);
    },
  });
}

export function useCreateInventoryItem(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInventoryItemInput): Promise<InventoryItem> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/inventory", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not add inventory item."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["low-stock", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["shopping-list", serverUrl] }),
      ]);
    },
  });
}

export function useUpdateInventoryItem(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: InventoryItemPatch;
    }): Promise<InventoryItem> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PATCH("/api/inventory/{id}", {
        credentials: "include",
        params: { path: { id: input.id } },
        body: input.patch,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not update inventory item."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["low-stock", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["shopping-list", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-stats", serverUrl] }),
      ]);
    },
  });
}

export function useDeleteInventoryItem(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/inventory/{id}", {
        credentials: "include",
        params: { path: { id } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete inventory item."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["low-stock", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["shopping-list", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-reservations", serverUrl] }),
      ]);
    },
  });
}
