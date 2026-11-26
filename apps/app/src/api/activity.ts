// SPDX-License-Identifier: AGPL-3.0-or-later
import type { components } from "@brew-bruvs/api-contract";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatApiError, getApiClient } from "./client";

export type ActivityEvent = Omit<components["schemas"]["ActivityEvent"], "status"> & {
  status: components["schemas"]["BatchStatus"] | null;
};
export type ActivityPage = {
  items: ActivityEvent[];
  nextOffset: number | null;
};

export const ACTIVITY_PAGE_SIZE = 25;

export async function fetchBreweryActivityPage(
  serverUrl: string,
  token: string | null,
  breweryId: string,
  opts: { limit?: number; offset?: number } = {},
  customFetch?: typeof fetch,
): Promise<ActivityPage> {
  const client = getApiClient(serverUrl, {
    token,
    ...(customFetch ? { customFetch } : {}),
  });
  const { data, error } = await client.GET("/api/breweries/{id}/activity", {
    credentials: "include",
    params: {
      path: { id: breweryId },
      query: {
        limit: opts.limit ?? ACTIVITY_PAGE_SIZE,
        offset: opts.offset ?? 0,
      },
    },
  });
  if (error || !data) {
    throw new Error(formatApiError(error, "Could not load brewery activity."));
  }
  return data;
}

export function useBreweryActivity(
  serverUrl: string | null,
  token: string | null,
  breweryId: string | null,
  opts: { limit?: number; enabled?: boolean } = {},
  customFetch?: typeof fetch,
) {
  const limit = opts.limit ?? ACTIVITY_PAGE_SIZE;
  return useInfiniteQuery({
    queryKey: ["brewery-activity", serverUrl, breweryId, limit],
    enabled: Boolean(serverUrl && breweryId) && (opts.enabled ?? true),
    retry: false,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      if (!serverUrl || !breweryId) throw new Error("Missing server or brewery id");
      return fetchBreweryActivityPage(
        serverUrl,
        token,
        breweryId,
        { limit, offset: pageParam },
        customFetch,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
}
