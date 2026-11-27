// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type Device = components["schemas"]["Device"];
export type DeviceInput = components["schemas"]["DeviceInput"];
export type IssuedDevice = components["schemas"]["IssuedDevice"];
export type DeviceKind = Device["kind"];
export type TiltColor = NonNullable<Device["tiltColor"]>;

export type Webhook = components["schemas"]["Webhook"];
export type WebhookInput = components["schemas"]["WebhookInput"];
export type IssuedWebhook = components["schemas"]["IssuedWebhook"];

export type BrewfatherCredentials = components["schemas"]["BrewfatherCredentials"];
export type BrewfatherRecipeDraft = components["schemas"]["BrewfatherRecipeDraft"];
export type BrewfatherImport = components["schemas"]["BrewfatherImport"];

export interface BrewfatherSaveResult {
  recipeIds: string[];
  batchIds: string[];
  inventoryIds: string[];
}

export function extractDeviceToken(uploadUrl: string): string | null {
  try {
    return new URL(uploadUrl).searchParams.get("token");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hydrometer Devices (P2-07)
// ---------------------------------------------------------------------------

export async function fetchDevices(
  serverUrl: string,
  token: string | null,
  customFetch?: typeof fetch,
): Promise<Device[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/integrations/devices", {
    credentials: "include",
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load device integrations."));
  }
  return data.items;
}

export function useDevices(
  serverUrl: string | null,
  token: string | null,
  enabled = true,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["integrations-devices", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchDevices(serverUrl, token, customFetch);
    },
  });
}

export function useCreateDevice(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeviceInput): Promise<IssuedDevice> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/integrations/devices", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create device integration."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["integrations-devices", serverUrl] });
    },
  });
}

export function useRotateDeviceToken(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<IssuedDevice> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/integrations/devices/{id}/rotate", {
        credentials: "include",
        params: { path: { id } },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not rotate device token."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["integrations-devices", serverUrl] });
    },
  });
}

export function useRevokeDevice(
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
      const { error } = await client.DELETE("/api/integrations/devices/{id}", {
        credentials: "include",
        params: { path: { id } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not revoke device integration."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["integrations-devices", serverUrl] });
    },
  });
}

// ---------------------------------------------------------------------------
// Outgoing Webhooks (P2-08)
// ---------------------------------------------------------------------------

export async function fetchWebhooks(
  serverUrl: string,
  token: string | null,
  opts: { breweryId?: string | null } = {},
  customFetch?: typeof fetch,
): Promise<Webhook[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/integrations/webhooks", {
    credentials: "include",
    params: {
      query: {
        ...(opts.breweryId ? { breweryId: opts.breweryId } : {}),
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load webhooks."));
  }
  return data.items;
}

export function useWebhooks(
  serverUrl: string | null,
  token: string | null,
  opts: { breweryId?: string | null; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["integrations-webhooks", serverUrl, opts.breweryId ?? null],
    enabled: Boolean(serverUrl) && (opts.enabled ?? true),
    retry: false,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchWebhooks(serverUrl, token, opts, customFetch);
    },
  });
}

export function useCreateWebhook(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: WebhookInput): Promise<IssuedWebhook> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/integrations/webhooks", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not create webhook."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["integrations-webhooks", serverUrl] });
    },
  });
}

export function useTestWebhook(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ queued: true }> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/integrations/webhooks/{id}/test", {
        credentials: "include",
        params: { path: { id } },
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not queue webhook test delivery."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["integrations-webhooks", serverUrl] });
    },
  });
}

export function useDeleteWebhook(
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
      const { error } = await client.DELETE("/api/integrations/webhooks/{id}", {
        credentials: "include",
        params: { path: { id } },
      });
      if (error) {
        throw new Error(formatApiError(error, "Could not delete webhook."));
      }
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await queryClient.invalidateQueries({ queryKey: ["integrations-webhooks", serverUrl] });
    },
  });
}

// ---------------------------------------------------------------------------
// Brewfather Import (P2-09)
// ---------------------------------------------------------------------------

export function usePreviewBrewfather(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  return useMutation({
    gcTime: 0,
    mutationFn: async (input: BrewfatherCredentials): Promise<BrewfatherImport> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/integrations/brewfather/preview", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not fetch Brewfather preview."));
      }
      return data;
    },
  });
}

export function useSaveBrewfather(
  serverUrl: string | null,
  token: string | null,
  customFetch?: typeof fetch,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BrewfatherImport): Promise<BrewfatherSaveResult> => {
      if (!serverUrl) throw new Error("Not connected to a server.");
      const client = getApiClient(serverUrl, {
        token,
        ...(customFetch ? { customFetch } : {}),
      });
      const { data, error } = await client.POST("/api/integrations/brewfather/import", {
        credentials: "include",
        body: input,
      });
      if (error || !data) {
        throw new Error(formatApiError(error, "Could not save Brewfather import."));
      }
      return data;
    },
    onSuccess: async () => {
      if (!serverUrl) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recipes", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["batches", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-low-stock", serverUrl] }),
        queryClient.invalidateQueries({ queryKey: ["shopping-list", serverUrl] }),
      ]);
    },
  });
}
