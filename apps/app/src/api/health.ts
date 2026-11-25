// SPDX-License-Identifier: AGPL-3.0-or-later

import type { components } from "@brew-bruvs/api-contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { normalizeServerUrl } from "../state/server";
import { formatApiError, getApiClient } from "./client";

export async function verifyServerHealth(
  rawUrl: string,
  customFetch?: typeof fetch,
): Promise<components["schemas"]["Health"] & { url: string }> {
  const normalized = normalizeServerUrl(rawUrl);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const client = getApiClient(normalized.url, customFetch);
  let data: components["schemas"]["Health"] | undefined;
  let error: unknown;
  try {
    const response = await client.GET("/healthz");
    data = response.data;
    error = response.error;
  } catch (err) {
    throw new Error(
      formatApiError(err, `Could not reach ${normalized.url}. Check the address and network.`),
    );
  }

  if (error || !data || data.status !== "ok") {
    throw new Error(
      formatApiError(
        error,
        `Server at ${normalized.url} did not respond as a healthy Brew-Bruvs server.`,
      ),
    );
  }

  return { ...data, url: normalized.url };
}

export function useVerifyServer(customFetch?: typeof fetch) {
  return useMutation({
    mutationFn: (rawUrl: string) => verifyServerHealth(rawUrl, customFetch),
  });
}

export function useServerHealth(serverUrl: string | null, customFetch?: typeof fetch) {
  return useQuery({
    queryKey: ["server-health", serverUrl],
    enabled: Boolean(serverUrl),
    retry: false,
    queryFn: async () => {
      if (!serverUrl) {
        throw new Error("No server configured");
      }
      return verifyServerHealth(serverUrl, customFetch);
    },
  });
}
