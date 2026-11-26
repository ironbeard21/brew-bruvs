// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ApiError, createApiClient } from "@brew-bruvs/api-contract";
import { Platform } from "react-native";
import { platformFetch } from "./transport";

export type BrewBruvsApiClient = ReturnType<typeof createApiClient>;

export interface ApiClientOptions {
  token?: string | null;
  customFetch?: typeof fetch;
}

export function getApiClient(
  baseUrl: string,
  options?: ApiClientOptions | typeof fetch,
): BrewBruvsApiClient {
  const opts: ApiClientOptions =
    typeof options === "function" ? { customFetch: options } : (options ?? {});
  let transport = opts.customFetch;
  if (Platform.OS !== "web") {
    // Phone builds allow cleartext for home servers, so never follow a redirect: it could carry
    // a password or token from https:// on to http://. Our API never redirects.
    const base = transport ?? platformFetch;
    transport = (input, init) => base(input, { ...init, redirect: "error" });
  }
  const client = createApiClient(baseUrl, transport ? { fetch: transport } : undefined);
  if (opts.token) {
    const bearer = opts.token;
    client.use({
      onRequest({ request }) {
        request.headers.set("Authorization", `Bearer ${bearer}`);
        return request;
      },
    });
  }
  return client;
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
