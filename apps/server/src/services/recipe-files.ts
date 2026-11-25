// SPDX-License-Identifier: AGPL-3.0-or-later
import { catalogTables, type Db, schema } from "@brew-bruvs/db";
import { eq } from "drizzle-orm";
import type { RecipeFile, RecipeFileFormat } from "../contracts/recipe-file.ts";
import { importBeerJson } from "../importers/beerjson.ts";
import { importBeerXml } from "../importers/beerxml.ts";
import { importRecipePage } from "../importers/recipe-page.ts";
import { createRemoteRecipeReader } from "../importers/remote-recipe.ts";
import type { User } from "../permissions.ts";
import { signedIn } from "./access.ts";

type IngredientCatalog = "fermentables" | "hops" | "yeasts" | "miscs";
const key = (name: string) => name.trim().toLowerCase();

function addMatch(index: Map<string, string | null>, name: string, id: string) {
  const normalized = key(name);
  const previous = index.get(normalized);
  index.set(normalized, previous === undefined || previous === id ? id : null);
}

export async function loadIngredientMatcher(db: Db, catalog: IngredientCatalog) {
  const table = catalogTables[catalog];
  const rows = await db
    .select({ id: table.id, name: table.name, aliases: table.aliases })
    .from(table);
  const names = new Map<string, string | null>();
  const aliases = new Map<string, string | null>();
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.id);
    addMatch(names, row.name, row.id);
    for (const alias of row.aliases) addMatch(aliases, alias, row.id);
  }
  return <T extends { name: string; catalogId?: string | null | undefined }>(
    line: T,
    native = false,
  ) => {
    if (native && !line.catalogId) return line;
    if (line.catalogId && ids.has(line.catalogId)) return line;
    const name = key(line.name);
    const catalogId = names.has(name) ? names.get(name) : aliases.get(name);
    return { ...line, catalogId: catalogId ?? undefined };
  };
}

async function matchLines<T extends { name: string; catalogId?: string | undefined }>(
  db: Db,
  catalog: IngredientCatalog,
  lines: T[],
  native: boolean,
) {
  if (!lines.length) return lines;
  const match = await loadIngredientMatcher(db, catalog);
  return lines.map((line) => match(line, native));
}

export function createRecipeFileService(db: Db, readUrl = createRemoteRecipeReader()) {
  async function draft(recipe: RecipeFile, native: boolean) {
    const { content } = recipe;
    const [fermentables, hops, yeasts, miscs, style] = await Promise.all([
      matchLines(db, "fermentables", content.fermentables, native),
      matchLines(db, "hops", content.hops, native),
      matchLines(db, "yeasts", content.yeasts, native),
      matchLines(db, "miscs", content.miscs, native),
      recipe.styleId
        ? db
            .select({ id: schema.styles.id })
            .from(schema.styles)
            .where(eq(schema.styles.id, recipe.styleId))
        : [],
    ]);
    return {
      ...recipe,
      visibility: "private" as const,
      ...(recipe.styleId && { styleId: style[0]?.id ?? null }),
      credit: recipe.credit ?? { sourceUrl: null, publicSharingBlocked: false },
      content: { ...content, fermentables, hops, yeasts, miscs },
    };
  }

  return {
    async preview(viewer: User | null, format: RecipeFileFormat, contents: string) {
      signedIn(viewer);
      const { recipe, native } =
        format === "beerxml" ? importBeerXml(contents) : importBeerJson(contents);
      return draft(recipe, native);
    },
    async previewUrl(viewer: User | null, url: string, batchSizeL?: number) {
      signedIn(viewer);
      const { recipe, excerpt } = await readUrl(url, (page, attachment) =>
        importRecipePage(page, attachment, batchSizeL),
      );
      return { draft: await draft(recipe, false), excerpt };
    },
  };
}

export type RecipeFileService = ReturnType<typeof createRecipeFileService>;
