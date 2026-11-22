// SPDX-License-Identifier: AGPL-3.0-or-later
// Password hashing (scrypt) and random tokens. Only hashes are ever stored.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP scrypt option N=2^15, r=8, p=3: ~32 MiB per hash, gentle on small home servers.
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEY_LENGTH = 32;
const MAX_MEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, fail) =>
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? fail(err) : ok(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split("$");
  if (algo !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(
    password,
    Buffer.from(salt, "base64"),
    Number(n),
    Number(r),
    Number(p),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A fixed hash to verify against when the email is unknown, so timing doesn't reveal accounts.
const DUMMY = hashPassword("not-a-real-password");
export async function burnPasswordCheck(password: string): Promise<false> {
  await verifyPassword(password, await DUMMY);
  return false;
}

/** A new random secret: `bb_` + 43 base64url characters (256 bits). */
export function newSecret(): string {
  return `bb_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
