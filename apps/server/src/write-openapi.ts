// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes the OpenAPI document generated from the route definitions to the path given as argv[2].
import { writeFileSync } from "node:fs";
import { createApp, OPENAPI_INFO } from "./app.ts";
import { createLogger } from "./logger.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: node src/write-openapi.ts <output.json>");

const app = createApp({ logger: createLogger("error"), webDir: undefined });
writeFileSync(out, `${JSON.stringify(app.getOpenAPI31Document(OPENAPI_INFO), null, 2)}\n`);
