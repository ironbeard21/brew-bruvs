// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [mode, stateFile, baseUrl = "http://127.0.0.1:8080"] = process.argv.slice(2);
if (!stateFile || (mode !== "seed" && mode !== "verify")) {
  throw new Error("Usage: node scripts/release-data-check.ts seed|verify state.json [base-url]");
}

const email = "release-data@example.test";
const recipeContent = {
  schemaVersion: 1,
  efficiencyPct: 72,
  fermentables: [{ name: "Pale malt", kind: "grain", amountKg: 4.5, potentialSg: 1.037 }],
  hops: [],
  yeasts: [{ name: "US-05", attenuationPct: 78 }],
  miscs: [],
  mash: [],
  fermentation: [],
};

async function api(path: string, expected: number, body?: object, token?: string) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body ? "POST" : "GET",
    headers: {
      ...(body && { "content-type": "application/json" }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, expected, `${path}: expected ${expected}, got ${response.status}`);
  return response.json();
}

async function snapshot(token: string, recipeId: string, batchId: string) {
  const user = await api("/api/me", 200, undefined, token);
  const recipe = await api(`/api/recipes/${recipeId}`, 200, undefined, token);
  const version = await api(`/api/recipes/${recipeId}/versions/1`, 200, undefined, token);
  const batch = await api(`/api/batches/${batchId}`, 200, undefined, token);
  const readings = await api(`/api/batches/${batchId}/readings`, 200, undefined, token);
  assert.equal(readings.length, 1);
  assert.equal(batch.recipe.id, recipeId);
  assert.equal(batch.recipe.versionId, version.id);
  return {
    user: { id: user.id, email: user.email, isAdmin: user.isAdmin },
    recipe: { id: recipe.id, name: recipe.name, visibility: recipe.visibility },
    version: { id: version.id, batchSizeL: version.batchSizeL, content: version.content },
    batch: { id: batch.id, name: batch.name, recipe: batch.recipe },
    reading: {
      id: readings[0].id,
      gravitySg: readings[0].gravitySg,
      temperatureC: readings[0].temperatureC,
    },
  };
}

if (mode === "seed") {
  assert.equal((await api("/api/auth/status", 200)).setupNeeded, true);
  const password = randomUUID();
  const { token } = await api("/api/setup", 201, {
    email,
    password,
    displayName: "Release test brewer",
    client: "app",
  });
  const { id: recipeId } = await api(
    "/api/recipes",
    201,
    {
      name: "Release test pale ale",
      beverage: "beer",
      visibility: "private",
      batchSizeL: 20,
      content: recipeContent,
    },
    token,
  );
  const { id: batchId } = await api(
    "/api/batches",
    201,
    {
      recipeId,
      name: "Release test batch",
    },
    token,
  );
  await api(
    `/api/batches/${batchId}/readings`,
    201,
    {
      takenAt: "2026-01-01T12:00:00Z",
      gravitySg: 1.048,
      temperatureC: 19.5,
    },
    token,
  );
  const expected = await snapshot(token, recipeId, batchId);
  writeFileSync(stateFile, JSON.stringify({ password, token, recipeId, batchId, expected }), {
    mode: 0o600,
  });
  console.log("Created a test admin, recipe, batch and gravity reading.");
} else {
  const { password, token, recipeId, batchId, expected } = JSON.parse(
    readFileSync(stateFile, "utf8"),
  );
  assert.equal((await api("/api/auth/status", 200)).setupNeeded, false);
  const login = await api("/api/auth/login", 200, { email, password, client: "app" });
  assert.equal(login.user.id, expected.user.id);
  assert.deepEqual(await snapshot(token, recipeId, batchId), expected);
  console.log(
    "The admin credentials, session, recipe, recipe version, batch and reading survived.",
  );
}
