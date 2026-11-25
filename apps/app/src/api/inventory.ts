// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useQuery } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type InventoryItem = components["schemas"]["InventoryItem"];
export type QuantityUnit = components["schemas"]["QuantityUnit"];

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
  const { data, error } = await client.GET("/api/inventory", {
    credentials: "include",
    params: {
      query: {
        ...(opts.breweryId ? { breweryId: opts.breweryId } : {}),
        ...(trimmed ? { q: trimmed } : {}),
        limit: opts.limit ?? 50,
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load inventory."));
  }
  return data.items;
}

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
