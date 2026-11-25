// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ApiError } from "../errors.ts";
import {
  type Address,
  publicDestination,
  publicWebUrl,
  type Resolver,
  systemResolve,
} from "./public-target.ts";

function refuse(message: string): never {
  throw new ApiError(400, "invalid_webhook_url", message);
}

function post(
  url: URL,
  target: Address,
  body: string,
  headers: Record<string, string>,
  signal: AbortSignal,
) {
  return new Promise<number>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "POST",
        agent: false,
        family: target.family,
        lookup: (_host, _options, callback) => callback(null, target.address, target.family),
        headers,
        signal,
      },
      (response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

export function createWebhookSender(resolve: Resolver = systemResolve, send = post) {
  async function destination(input: string, signal: AbortSignal) {
    const url = publicWebUrl(input, refuse);
    const timeout = new Promise<never>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
    const address = await Promise.race([publicDestination(url, resolve, refuse), timeout]);
    signal.throwIfAborted();
    return { url, address };
  }

  return {
    async validate(input: string) {
      try {
        return (await destination(input, AbortSignal.timeout(5_000))).url.href;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        refuse("Could not resolve the webhook destination");
      }
    },
    async deliver(input: string, key: string, jobId: string, event: unknown) {
      const signal = AbortSignal.timeout(5_000);
      const { url, address } = await destination(input, signal);
      const body = JSON.stringify(event);
      const signature = createHmac("sha256", key).update(body).digest("hex");
      const status = await send(
        url,
        address,
        body,
        {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
          "User-Agent": "BrewBruvs",
          "Brew-Bruvs-Delivery": jobId,
          "Brew-Bruvs-Signature": `sha256=${signature}`,
        },
        signal,
      );
      return status >= 200 && status < 300;
    },
  };
}

export type WebhookSender = ReturnType<typeof createWebhookSender>;
