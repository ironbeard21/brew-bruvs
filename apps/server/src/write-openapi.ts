// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes the OpenAPI document generated from the route definitions to the path given as argv[2],
// and the recipe content JSON Schema next to it as recipe-content.schema.json.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createDb } from "@brew-bruvs/db";
import { createApp, OPENAPI_INFO } from "./app.ts";
import { recipeContentJsonSchema } from "./contracts/recipe-content.ts";
import { createLogger } from "./logger.ts";
import { createAuthService } from "./services/auth.ts";
import { createBatchService } from "./services/batches.ts";
import { createBreweryService } from "./services/breweries.ts";
import { createCatalogService } from "./services/catalog.ts";
import { createEquipmentProfileService } from "./services/equipment-profiles.ts";
import { createInventoryService } from "./services/inventory.ts";
import { createNoteService } from "./services/notes.ts";
import { createRecipeFileService } from "./services/recipe-files.ts";
import { createRecipeService } from "./services/recipes.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: node src/write-openapi.ts <output.json>");

// Building the document never queries the database; pg connects lazily.
const { db } = createDb("postgres://unused@localhost/unused");
const baseUrl = "http://localhost";
const profiles = createEquipmentProfileService(db, { baseUrl });
const app = createApp({
  logger: createLogger("error"),
  webDir: undefined,
  catalog: createCatalogService(db),
  profiles,
  recipes: createRecipeService(db, { baseUrl, profiles }),
  recipeFiles: createRecipeFileService(db),
  batches: createBatchService(db, { baseUrl, profiles }),
  notes: createNoteService(db, { baseUrl }),
  breweries: createBreweryService(db, { baseUrl }),
  inventory: createInventoryService(db, { baseUrl }),
  auth: {
    auth: createAuthService(db, { baseUrl, signupMode: "invite" }),
    oidc: undefined,
    baseUrl,
    signupMode: "invite",
    trustProxy: false,
  },
});
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
writeFileSync(out, json(app.getOpenAPI31Document(OPENAPI_INFO)));
writeFileSync(join(dirname(out), "recipe-content.schema.json"), json(recipeContentJsonSchema()));
