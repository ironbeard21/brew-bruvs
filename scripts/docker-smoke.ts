// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8080";
const fetchApp = (path: string, init?: RequestInit) => fetch(new URL(path, baseUrl), init);

const health = await fetchApp("/healthz");
assert.equal(health.status, 200);
assert.equal(
  (await health.json()).sourceUrl,
  process.argv[3] ?? "https://github.com/ironbeard21/brew-bruvs",
);

const web = await fetchApp("/");
assert.equal(web.status, 200);
assert.match(web.headers.get("content-type") ?? "", /^text\/html\b/);
assert.match(web.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
assert.equal(web.headers.get("x-content-type-options"), "nosniff");
assert.equal(web.headers.get("referrer-policy"), "no-referrer");

const authStatus = async () => {
  const response = await fetchApp("/api/auth/status");
  assert.equal(response.status, 200);
  return response.json();
};

assert.equal((await authStatus()).setupNeeded, true);
const setup = () =>
  fetchApp("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "docker-smoke@example.test",
      displayName: "Docker Smoke Test",
      password: randomUUID(),
    }),
  });

const admin = await setup();
assert.equal(admin.status, 201);
assert.equal((await admin.json()).user.isAdmin, true);
assert.equal((await authStatus()).setupNeeded, false);
assert.equal((await setup()).status, 409);
console.log("The Docker app served the web build and completed first-run admin setup.");
