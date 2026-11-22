// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed-window attempt counters for sign-in routes. In memory: one server process per install.

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { ApiError } from "../errors.ts";

export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #windows = new Map<string, { count: number; resetAt: number }>();

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /** Seconds until `key` may try again, or 0 if it isn't blocked. Doesn't count an attempt. */
  retryAfter(key: string): number {
    const w = this.#windows.get(key);
    const now = this.#now();
    if (!w || w.resetAt <= now || w.count < this.#limit) return 0;
    return Math.ceil((w.resetAt - now) / 1000);
  }

  /** Counts one attempt for `key`. */
  hit(key: string): void {
    const now = this.#now();
    if (this.#windows.size > 10_000) {
      for (const [k, w] of this.#windows) if (w.resetAt <= now) this.#windows.delete(k);
    }
    const w = this.#windows.get(key);
    if (!w || w.resetAt <= now) this.#windows.set(key, { count: 1, resetAt: now + this.#windowMs });
    else w.count++;
  }

  clear(key: string): void {
    this.#windows.delete(key);
  }
}

/** Throws 429 with Retry-After when `key` is blocked. */
export function enforce(c: Context, limiter: RateLimiter, key: string): void {
  const wait = limiter.retryAfter(key);
  if (wait === 0) return;
  c.header("Retry-After", String(wait));
  throw new ApiError(
    429,
    "rate_limited",
    `Too many attempts; try again in ${Math.ceil(wait / 60)} minute(s)`,
  );
}

/**
 * The caller's IP. Behind a reverse proxy (TRUST_PROXY=true) it's the last X-Forwarded-For
 * entry, the one the proxy added; earlier entries are client-supplied and can be forged.
 */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket (in-process requests, e.g. tests): every such caller shares one bucket.
    return "unknown";
  }
}
