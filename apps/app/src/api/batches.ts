// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type Batch = components["schemas"]["Batch"];
export type Note = components["schemas"]["Note"];

export async function fetchMyBatches(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<Batch[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches", {
    credentials: "include",
    params: { query: { mine: "true", limit: 100 } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load your batches."));
  }
  return data.items;
}

export interface CreateBatchNoteInput {
  batchId: string;
  body: string;
}

export async function createBatchNote(
  serverUrl: string,
  token: string | null,
  input: CreateBatchNoteInput,
  customFetch?: typeof fetch,
): Promise<Note> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.POST("/api/notes", {
    credentials: "include",
    body: {
      kind: "general",
      batchId: input.batchId,
      body: input.body,
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not save note to batch."));
  }
  return data;
}

export function useMyBatches(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["my-batches", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchMyBatches(serverUrl, token, customFetch);
    },
  });
}

export function useCreateBatchNote(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBatchNoteInput) => {
      if (!serverUrl) throw new Error("Not connected to a server");
      return createBatchNote(serverUrl, token, input, customFetch);
    },
    onSuccess: async () => {
      if (serverUrl) {
        await queryClient.invalidateQueries({ queryKey: ["my-batches", serverUrl] });
      }
    },
  });
}
