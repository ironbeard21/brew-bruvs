// SPDX-License-Identifier: AGPL-3.0-or-later
import type { z } from "zod";
import type { BrewfatherCredentials } from "../contracts/brewfather.ts";
import { ApiError } from "../errors.ts";

export type BrewfatherFetch = typeof fetch;
type Entry = Record<string, unknown>;
const pageSize = 50;
const maxBytes = 16 * 1024 * 1024;

export function brewfatherClient(
  input: z.infer<typeof BrewfatherCredentials>,
  fetcher: BrewfatherFetch,
) {
  const authorization = `Basic ${Buffer.from(`${input.userId}:${input.apiKey}`).toString("base64")}`;
  const signal = AbortSignal.timeout(120_000);
  let bytes = 0;

  async function read(path: string, params?: URLSearchParams): Promise<Entry[]> {
    const url = new URL(`https://api.brewfather.app/v2/${path}`);
    if (params) url.search = params.toString();
    try {
      const res = await fetcher(url, {
        headers: { authorization, accept: "application/json" },
        redirect: "error",
        signal,
      });
      if (!res.ok) {
        await res.body?.cancel();
        if (res.status === 401 || res.status === 403) {
          throw new ApiError(
            400,
            "brewfather_credentials",
            "Check the Brewfather credentials and API permissions",
          );
        }
        if (res.status === 429) {
          throw new ApiError(
            429,
            "brewfather_rate_limit",
            "Brewfather rate limited the request. Try again later.",
          );
        }
        throw new ApiError(
          502,
          "brewfather_unavailable",
          "Brewfather could not complete the request",
        );
      }
      if (!res.body) throw new Error();
      const decoder = new TextDecoder();
      let json = "";
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new ApiError(413, "brewfather_import_too_large", "Brewfather import is too large");
        }
        json += decoder.decode(value, { stream: true });
      }
      const result: unknown = JSON.parse(json + decoder.decode());
      if (
        !Array.isArray(result) ||
        result.some((item) => !item || typeof item !== "object" || Array.isArray(item))
      ) {
        throw new Error();
      }
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "brewfather_unavailable", "Could not read the Brewfather response");
    }
  }

  return {
    async list(path: string, max: number) {
      const rows: Entry[] = [];
      const cursors = new Set<string>();
      const params = new URLSearchParams({ complete: "true", limit: String(pageSize) });
      while (true) {
        const page = await read(path, params);
        rows.push(...page);
        if (rows.length > max || page.length > pageSize) {
          throw new ApiError(413, "brewfather_import_too_large", "Brewfather import is too large");
        }
        if (page.length < pageSize) return rows;
        const next = page.at(-1)?._id;
        if (typeof next !== "string" || cursors.has(next)) {
          throw new ApiError(502, "brewfather_unavailable", "Brewfather returned an invalid page");
        }
        cursors.add(next);
        params.set("start_after", next);
      }
    },
    readings(id: string) {
      return read(`batches/${encodeURIComponent(id)}/readings`);
    },
  };
}
