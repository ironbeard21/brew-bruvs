// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes the OpenAPI document generated from the route definitions to the path given as argv[2].
import { writeFileSync } from "node:fs";
import { createDb } from "@brew-bruvs/db";
import { createApp, OPENAPI_INFO } from "./app.ts";
import { createLogger } from "./logger.ts";
import { createAuthService } from "./services/auth.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: node src/write-openapi.ts <output.json>");

// Building the document never queries the database; pg connects lazily.
const { db } = createDb("postgres://unused@localhost/unused");
const baseUrl = "http://localhost";
const app = createApp({
  logger: createLogger("error"),
  webDir: undefined,
  auth: {
    auth: createAuthService(db, { baseUrl, signupMode: "invite" }),
    oidc: undefined,
    baseUrl,
    signupMode: "invite",
  },
});
writeFileSync(out, `${JSON.stringify(app.getOpenAPI31Document(OPENAPI_INFO), null, 2)}\n`);
