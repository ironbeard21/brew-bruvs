// SPDX-License-Identifier: AGPL-3.0-or-later
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "../src/auth/rate-limit.ts";

describe("RateLimiter", () => {
  it("blocks after the limit until the window ends", () => {
    let now = 0;
    const limiter = new RateLimiter(3, 60_000, () => now);
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfter("a")).toBe(0);
      limiter.hit("a");
    }
    expect(limiter.retryAfter("a")).toBe(60);
    expect(limiter.retryAfter("b")).toBe(0); // other keys are separate
    now = 45_500;
    expect(limiter.retryAfter("a")).toBe(15);
    now = 60_000;
    expect(limiter.retryAfter("a")).toBe(0);
    limiter.hit("a"); // a new window starts
    expect(limiter.retryAfter("a")).toBe(0);
  });

  it("forgets a key when cleared", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit("a");
    expect(limiter.retryAfter("a")).toBeGreaterThan(0);
    limiter.clear("a");
    expect(limiter.retryAfter("a")).toBe(0);
  });

  it("drops expired windows once it tracks many keys", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1_000, () => now);
    for (let i = 0; i <= 10_001; i++) limiter.hit(`k${i}`);
    now = 2_000;
    limiter.hit("fresh");
    now = 0; // if old windows were kept, k1 would still be blocked at time 0
    expect(limiter.retryAfter("k1")).toBe(0);
    expect(limiter.retryAfter("fresh")).toBe(3);
  });
});

describe("clientIp", () => {
  const ipOf = async (trustProxy: boolean, header?: string) => {
    const app = new Hono().get("/", (c) => c.text(clientIp(c, trustProxy)));
    const res = await app.request("/", header ? { headers: { "x-forwarded-for": header } } : {});
    return res.text();
  };

  it("uses the address the proxy added (the last X-Forwarded-For entry)", async () => {
    expect(await ipOf(true, "6.6.6.6, 203.0.113.7")).toBe("203.0.113.7");
  });

  it("ignores X-Forwarded-For unless the proxy is trusted", async () => {
    expect(await ipOf(false, "203.0.113.7")).toBe("unknown");
  });

  it("falls back when there's no header", async () => {
    expect(await ipOf(true)).toBe("unknown");
  });
});
