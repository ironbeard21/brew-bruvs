// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { hashPassword, hashSecret, newSecret, verifyPassword } from "../src/auth/secrets.ts";

describe("passwords", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("x", "md5$abc")).toBe(false);
  });
});

describe("secrets", () => {
  it("are random, prefixed, and stored only as a SHA-256 hash", () => {
    const a = newSecret();
    expect(a).toMatch(/^bb_[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(a);
    expect(hashSecret(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
