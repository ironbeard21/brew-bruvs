// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type EquipmentItem = components["schemas"]["EquipmentItem"];
export type EquipmentItemInput = components["schemas"]["EquipmentItemInput"];
export type EquipmentItemPatch = components["schemas"]["EquipmentItemPatch"];
export type EquipmentCondition = NonNullable<EquipmentItem["condition"]>;

const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

export async function fetchEquipmentItems(
  serverUrl: string,
  token: string | null,
  opts: { breweryId?: string | null } = {},
  customFetch?: typeof fetch,
): Promise<EquipmentItem[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const all: EquipmentItem[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await client.GET("/api/equipment", {
      credentials: "include",
      params: {
        query: {
          ...(opts.breweryId ? { breweryId: opts.breweryId } : {}),
          limit: PAGE_LIMIT,
          offset,
        },
      },
    });
    if (error || !data) {
      throw new Error(formatApiError(error, "Could not load equipment."));
    }
    all.push(...data.items);
    if (data.nextOffset == null || data.nextOffset <= offset) {
      break;
    }
    offset = data.nextOffset;
  }
  return all;
}

export function useEquipmentItems(
  serverUrl: string | null,
  token: string | null,
  opts: { breweryId?: string | null; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["equipment-items", serverUrl, opts.breweryId ?? null],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchEquipmentItems(serverUrl, token, opts, customFetch);
    },
  });
}

export function useCreateEquipmentItem(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EquipmentItemInput): Promise<EquipmentItem> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/equipment", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not add equipment item."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["equipment-items", serverUrl] });
    },
  });
}

export function useUpdateEquipmentItem(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: EquipmentItemPatch;
    }): Promise<EquipmentItem> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PATCH("/api/equipment/{id}", {
        credentials: "include",
        params: { path: { id: input.id } },
        body: input.patch,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not update equipment item."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["equipment-items", serverUrl] });
    },
  });
}

export function useDeleteEquipmentItem(
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
      const { error } = await client.DELETE("/api/equipment/{id}", {
        credentials: "include",
        params: { path: { id } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete equipment item."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["equipment-items", serverUrl] });
    },
  });
}

export function useSetEquipmentHolder(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      heldByUserId: string | null;
    }): Promise<EquipmentItem> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PUT("/api/equipment/{id}/holder", {
        credentials: "include",
        params: { path: { id: input.id } },
        body: { heldByUserId: input.heldByUserId },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not update equipment holder."));
      }
      return data;
    },
    onSuccess: async (updated) => {
      if (!serverUrl) return;
      const tasks: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: ["equipment-items", serverUrl] }),
      ];
      if (updated.owner.type === "brewery") {
        tasks.push(
          queryClient.invalidateQueries({
            queryKey: ["brewery-activity", serverUrl, updated.owner.id],
          }),
        );
      }
      await Promise.all(tasks);
    },
  });
}
