// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type Batch = components["schemas"]["Batch"];
export type BatchDetail = components["schemas"]["BatchDetail"];
export type BatchStatus = components["schemas"]["BatchStatus"];
export type CreateBatchInput = components["schemas"]["CreateBatch"];
export type StatusResult = components["schemas"]["StatusResult"];
export type Reading = components["schemas"]["Reading"];
export type ReadingInput = components["schemas"]["ReadingInput"];
export type ReadingPatch = components["schemas"]["ReadingPatch"];
export type Reminder = components["schemas"]["Reminder"];
export type ReminderInput = components["schemas"]["ReminderInput"];
export type ReminderKind = Reminder["kind"];
export type Note = components["schemas"]["Note"];
export type NoteInput = components["schemas"]["NoteInput"];
export type TastingScores = components["schemas"]["TastingScores"];

export async function fetchMyBatches(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<Batch[]> {
  return fetchBatches(serverUrl, token, { mine: true }, customFetch);
}

export async function fetchBatches(
  serverUrl: string,
  token: string | null,
  opts: { mine?: boolean; status?: BatchStatus } = {},
  customFetch?: typeof fetch,
): Promise<Batch[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches", {
    credentials: "include",
    params: {
      query: {
        ...(opts.mine ? { mine: "true" } : {}),
        ...(opts.status ? { status: opts.status } : {}),
        limit: 100,
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load batches."));
  }
  return data.items;
}

export async function fetchBatchDetail(
  serverUrl: string,
  token: string | null,
  id: string,
  customFetch?: typeof fetch,
): Promise<BatchDetail> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches/{id}", {
    credentials: "include",
    params: { path: { id } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load batch."));
  }
  return data;
}

export async function fetchBatchReadings(
  serverUrl: string,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
): Promise<Reading[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches/{id}/readings", {
    credentials: "include",
    params: { path: { id: batchId } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load readings."));
  }
  return data;
}

export async function fetchBatchReminders(
  serverUrl: string,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
): Promise<Reminder[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/batches/{id}/reminders", {
    credentials: "include",
    params: { path: { id: batchId } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load reminders."));
  }
  return data;
}

export async function fetchDueReminders(
  serverUrl: string,
  token: string | null,
  untilIso?: string,
  customFetch?: typeof fetch,
): Promise<Reminder[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/reminders", {
    credentials: "include",
    params: {
      query: untilIso ? { until: untilIso } : {},
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load due reminders."));
  }
  return data;
}

export async function fetchBatchNotes(
  serverUrl: string,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
): Promise<Note[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/notes", {
    credentials: "include",
    params: { query: { batchId, limit: 100 } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load notes."));
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

// ── React Query hooks ────────────────────────────────────────────────

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

export function useBatches(
  serverUrl: string | null,
  token: string | null,
  opts: { mine?: boolean; status?: BatchStatus; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batches", serverUrl, Boolean(opts.mine), opts.status ?? "all"],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchBatches(serverUrl, token, opts, customFetch);
    },
  });
}

export function useBatchDetail(
  serverUrl: string | null,
  token: string | null,
  batchId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batch-detail", serverUrl, batchId],
    enabled: Boolean(serverUrl && batchId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !batchId) throw new Error("Missing server or batch id");
      return fetchBatchDetail(serverUrl, token, batchId, customFetch);
    },
  });
}

export function useBatchReadings(
  serverUrl: string | null,
  token: string | null,
  batchId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batch-readings", serverUrl, batchId],
    enabled: Boolean(serverUrl && batchId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !batchId) throw new Error("Missing server or batch id");
      return fetchBatchReadings(serverUrl, token, batchId, customFetch);
    },
  });
}

export function useBatchReminders(
  serverUrl: string | null,
  token: string | null,
  batchId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batch-reminders", serverUrl, batchId],
    enabled: Boolean(serverUrl && batchId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !batchId) throw new Error("Missing server or batch id");
      return fetchBatchReminders(serverUrl, token, batchId, customFetch);
    },
  });
}

export function useBatchNotes(
  serverUrl: string | null,
  token: string | null,
  batchId: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["batch-notes", serverUrl, batchId],
    enabled: Boolean(serverUrl && batchId),
    retry: false,
    queryFn: () => {
      if (!serverUrl || !batchId) throw new Error("Missing server or batch id");
      return fetchBatchNotes(serverUrl, token, batchId, customFetch);
    },
  });
}

export function useCreateBatch(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBatchInput): Promise<BatchDetail> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/batches", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not start batch."));
      }
      return data;
    },
    onSuccess: async (batch) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["batch-detail", serverUrl, batch.id], batch);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["my-batches", serverUrl] }),
      ]);
    },
  });
}

export function useDeleteBatch(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/batches/{id}", {
        credentials: "include",
        params: { path: { id: batchId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete batch."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["my-batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["low-stock", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["shopping-list", serverUrl] }),
      ]);
    },
  });
}

export function useChangeBatchStatus(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (status: BatchStatus): Promise<StatusResult> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/batches/{id}/status", {
        credentials: "include",
        params: { path: { id: batchId } },
        body: { status },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not change batch status."));
      }
      return data;
    },
    onSuccess: async (res) => {
      if (!serverUrl) return;
      queryClient.setQueryData(["batch-detail", serverUrl, batchId], res.batch);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batch-reminders", serverUrl, batchId] }),
        queryClient.invalidateQueries({ queryKey: ["batch-reservations", serverUrl, batchId] }),
        queryClient.invalidateQueries({ queryKey: ["batch-stats", serverUrl, batchId] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["low-stock", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["shopping-list", serverUrl] }),
      ]);
    },
  });
}

export function useAddReading(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReadingInput): Promise<Reading> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/batches/{id}/readings", {
        credentials: "include",
        params: { path: { id: batchId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not add reading."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-readings", serverUrl, batchId] });
    },
  });
}

export function useUpdateReading(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readingId: string; patch: ReadingPatch }): Promise<Reading> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.PATCH("/api/batches/{id}/readings/{readingId}", {
        credentials: "include",
        params: { path: { id: batchId, readingId: input.readingId } },
        body: input.patch,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not update reading."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-readings", serverUrl, batchId] });
    },
  });
}

export function useDeleteReading(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (readingId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/batches/{id}/readings/{readingId}", {
        credentials: "include",
        params: { path: { id: batchId, readingId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete reading."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-readings", serverUrl, batchId] });
    },
  });
}

export function useAddReminder(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReminderInput): Promise<Reminder> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/batches/{id}/reminders", {
        credentials: "include",
        params: { path: { id: batchId } },
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create reminder."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-reminders", serverUrl, batchId] });
    },
  });
}

export function useCompleteReminder(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reminderId: string): Promise<Reminder> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/reminders/{id}/done", {
        credentials: "include",
        params: { path: { id: reminderId } },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not complete reminder."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-reminders", serverUrl, batchId] });
    },
  });
}

export function useCreateNote(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: NoteInput): Promise<Note> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/notes", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not save note."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-notes", serverUrl, batchId] });
    },
  });
}

export function useDeleteNote(
  serverUrl: string | null,
  token: string | null,
  batchId: string,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: string): Promise<void> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { error } = await client.DELETE("/api/notes/{id}", {
        credentials: "include",
        params: { path: { id: noteId } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete note."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["batch-notes", serverUrl, batchId] });
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
    onSuccess: async (_note, input) => {
      if (serverUrl) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["my-batches", serverUrl] }),
          queryClient.invalidateQueries({ queryKey: ["batch-notes", serverUrl, input.batchId] }),
        ]);
      }
    },
  });
}
