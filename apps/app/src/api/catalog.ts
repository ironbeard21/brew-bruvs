// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useQuery } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type CatalogKind =
  | "hops"
  | "fermentables"
  | "yeasts"
  | "miscs"
  | "styles"
  | "water_profiles"
  | "equipment";

export type CatalogItem = components["schemas"]["CatalogItem"];
export type CatalogHop = components["schemas"]["CatalogHop"];
export type CatalogFermentable = components["schemas"]["CatalogFermentable"];
export type CatalogYeast = components["schemas"]["CatalogYeast"];
export type CatalogMisc = components["schemas"]["CatalogMisc"];
export type CatalogStyle = components["schemas"]["CatalogStyle"];
export type CatalogEquipment = components["schemas"]["CatalogEquipment"];
export type CatalogSource = components["schemas"]["CatalogSource"];
export type CatalogAttribution = components["schemas"]["CatalogAttribution"];

export async function searchCatalog(
  serverUrl: string,
  catalog: CatalogKind,
  query: string,
  token: string | null = null,
  customFetch?: typeof fetch,
): Promise<CatalogItem[]> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const trimmed = query.trim();
  const { data, error } = await client.GET("/api/catalog/{catalog}", {
    credentials: "include",
    params: {
      path: { catalog },
      query: { ...(trimmed ? { q: trimmed } : {}), limit: 20 },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, `Could not search ${catalog} catalog.`));
  }
  return data.items;
}

export async function fetchCatalogItem(
  serverUrl: string,
  catalog: CatalogKind,
  id: string,
  token: string | null = null,
  customFetch?: typeof fetch,
): Promise<CatalogItem> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/catalog/{catalog}/{id}", {
    credentials: "include",
    params: { path: { catalog, id } },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, `Could not load ${catalog} item.`));
  }
  return data;
}

export function useCatalogSearch(
  serverUrl: string | null,
  token: string | null,
  catalog: CatalogKind,
  query: string,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["catalog-search", serverUrl, catalog, query.trim()],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return searchCatalog(serverUrl, catalog, query, token, customFetch);
    },
  });
}

export async function fetchCatalogSources(
  serverUrl: string,
  token: string | null = null,
  customFetch?: typeof fetch,
): Promise<CatalogAttribution> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/catalog/sources", {
    credentials: "include",
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load catalog attribution."));
  }
  return data;
}

export function useCatalogSources(
  serverUrl: string | null,
  token: string | null,
  enabled: boolean,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["catalog-sources", serverUrl],
    enabled: Boolean(serverUrl) && enabled,
    retry: false,
    staleTime: 600_000,
    queryFn: () => {
      if (!serverUrl) throw new Error("No server configured");
      return fetchCatalogSources(serverUrl, token, customFetch);
    },
  });
}

export function useCatalogItem(
  serverUrl: string | null,
  token: string | null,
  catalog: CatalogKind,
  id: string | null,
  customFetch?: typeof fetch,
) {
  return useQuery({
    queryKey: ["catalog-item", serverUrl, catalog, id],
    enabled: Boolean(serverUrl && id),
    retry: false,
    staleTime: 300_000,
    queryFn: () => {
      if (!serverUrl || !id) throw new Error("Missing server or item id");
      return fetchCatalogItem(serverUrl, catalog, id, token, customFetch);
    },
  });
}
