// SPDX-License-Identifier: AGPL-3.0-or-later
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import robotsParser from "robots-parser";
import { ApiError } from "../errors.ts";
import {
  type Address,
  publicDestination,
  publicWebUrl,
  systemResolve,
} from "../integrations/public-target.ts";
import { invalidFile } from "./recipe-file.ts";

const agent = "BrewBruvs";
const redirects = new Set([301, 302, 303, 307, 308]);
const timeoutMs = 10_000;

export function invalidUrl(message: string): never {
  throw new ApiError(400, "invalid_recipe_url", message);
}

const webUrl = (input: string, base?: URL) => publicWebUrl(input, invalidUrl, base);

type RemoteResponse = {
  status: number;
  location?: string | undefined;
  mediaType?: string | undefined;
  body: string;
};

function requestPinned(
  url: URL,
  address: Address,
  maxBytes: number,
  signal: AbortSignal,
): Promise<RemoteResponse> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        family: address.family,
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
        signal,
        headers: { "User-Agent": agent, "Accept-Encoding": "identity" },
      },
      (res) => {
        res.on("error", reject);
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status < 200 || status >= 300) {
          resolve({ status, location, body: "" });
          res.destroy();
          return;
        }
        const encoding = res.headers["content-encoding"];
        if (
          (encoding && encoding.toLowerCase() !== "identity") ||
          Number(res.headers["content-length"]) > maxBytes
        ) {
          reject(new Error("Unsupported encoding or oversized response"));
          res.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            reject(new Error("Oversized response"));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status,
            mediaType: res.headers["content-type"]?.split(";")[0]?.trim().toLowerCase(),
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

type Transport = {
  resolve: (host: string) => Promise<Address[]>;
  request: typeof requestPinned;
};

const network: Transport = {
  resolve: systemResolve,
  request: requestPinned,
};

export function createRemoteRecipeReader(transport = network, deadlineMs = timeoutMs) {
  return async function readRecipeUrl<T>(
    input: string,
    read: (page: { url: URL; body: string }, attachment: (href: string) => Promise<string>) => T,
  ): Promise<Awaited<T>> {
    const signal = AbortSignal.timeout(deadlineMs);
    const stop = new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const rules = new Map<string, ReturnType<typeof robotsParser>>();
    let requests = 0;

    async function get(url: URL, maxBytes: number) {
      signal.throwIfAborted();
      if (++requests > 16) invalidUrl("The source exceeded the request limit");
      const first = await publicDestination(url, transport.resolve, () =>
        invalidUrl("Use a public recipe URL"),
      );
      signal.throwIfAborted();
      return transport.request(url, first, maxBytes, signal);
    }

    async function follow(start: URL, maxBytes: number, checkRobots: boolean) {
      let url = start;
      for (let hop = 0; hop <= 5; hop++) {
        if (checkRobots) await obeyRobots(url);
        const response = await get(url, maxBytes);
        if (!redirects.has(response.status)) return { ...response, url };
        if (!response.location) break;
        url = webUrl(response.location, url);
      }
      invalidUrl("The source returned too many or invalid redirects");
    }

    async function obeyRobots(url: URL) {
      let policy = rules.get(url.origin);
      if (!policy) {
        const policyUrl = new URL("/robots.txt", url);
        const response = await follow(policyUrl, 512 * 1024, false);
        if (response.status !== 200 && response.status !== 404 && response.status !== 410) {
          invalidUrl("The source's robots.txt could not be read");
        }
        policy = robotsParser(policyUrl.href, response.body);
        rules.set(url.origin, policy);
      }
      if (policy.isAllowed(url.href, agent) !== true) {
        invalidUrl("The source's robots.txt disallows importing this URL");
      }
    }

    const work = async () => {
      const page = await follow(webUrl(input), 2 * 1024 * 1024, true);
      if (
        page.status !== 200 ||
        !["text/html", "application/xhtml+xml"].includes(page.mediaType ?? "")
      ) {
        invalidUrl("Use a reachable HTML recipe page");
      }
      return read(page, async (href) => {
        const file = await follow(webUrl(href, page.url), 8 * 1024 * 1024, true);
        if (
          file.status !== 200 ||
          !file.body ||
          file.mediaType === "text/html" ||
          file.mediaType === "application/xhtml+xml"
        ) {
          invalidFile("The linked recipe file could not be read");
        }
        return file.body;
      });
    };

    try {
      return await Promise.race([work(), stop]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      invalidUrl("The source could not be read within the import limits");
    }
  };
}
