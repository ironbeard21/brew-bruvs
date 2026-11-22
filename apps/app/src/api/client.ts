// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ApiError, createApiClient } from "@brew-bruvs/api-contract";

export type BrewBruvsApiClient = ReturnType<typeof createApiClient>;

export function getApiClient(baseUrl: string, customFetch?: typeof fetch): BrewBruvsApiClient {
  return createApiClient(baseUrl, customFetch ? { fetch: customFetch } : undefined);
}

export function formatApiError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "error" in error) {
    const apiErr = error as Partial<ApiError>;
    if (apiErr.error && typeof apiErr.error.message === "string" && apiErr.error.message) {
      return apiErr.error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}
