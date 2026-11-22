// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from "node:crypto";
import { z } from "zod";
import { RecipeFile } from "../contracts/recipe-file.ts";
import { ApiError } from "../errors.ts";

export type FileStyle = {
  name: string;
  category: string | null;
  styleGuide: string;
  styleId: string | null;
  ogMin: number | null;
  ogMax: number | null;
  fgMin: number | null;
  fgMax: number | null;
  ibuMin: number | null;
  ibuMax: number | null;
  colorEbcMin: number | null;
  colorEbcMax: number | null;
};

export function styleCode(id: string | null) {
  const match = /^(\d+)([a-z]?)$/i.exec(id ?? "");
  return { category: match?.[1], letter: match?.[2]?.toUpperCase() || undefined };
}

export function invalidFile(message: string): never {
  throw new ApiError(400, "invalid_recipe_file", message);
}

// Object key order and file indentation do not affect the identity of a standard record.
function fingerprint(record: unknown): string {
  const canonical = JSON.stringify(record, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : Number(a > b))),
    );
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const Extra = z.object({ version: z.literal(1), fingerprint: z.string(), recipe: RecipeFile });

export function writeExtras(record: unknown, recipe: RecipeFile) {
  return JSON.stringify({ version: 1, fingerprint: fingerprint(record), recipe });
}

export function restoreRecipe(
  record: unknown,
  extra: string | undefined,
  fromStandard: () => RecipeFile,
) {
  if (!extra) return { recipe: fromStandard(), native: false };
  let metadata: z.infer<typeof Extra> | undefined;
  try {
    const result = Extra.safeParse(JSON.parse(extra));
    if (result.success) {
      metadata = result.data;
      if (metadata.fingerprint === fingerprint(record))
        return { recipe: metadata.recipe, native: true };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof RangeError)) throw error;
  }
  const recipe = fromStandard();
  // Edits to the standard brewing fields invalidate the original content snapshot.
  // Keep the original source credit even when a file has been edited.
  return {
    recipe: metadata?.recipe.credit ? { ...recipe, credit: metadata.recipe.credit } : recipe,
    native: false,
  };
}

export function parseRecipe(data: unknown): RecipeFile {
  const result = RecipeFile.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    invalidFile(issue ? `${issue.path.join(".") || "recipe"}: ${issue.message}` : "Invalid recipe");
  }
  return result.data;
}

export function fileCredit(author?: string, sourceUrl?: string): RecipeFile["credit"] {
  if (!author && !sourceUrl) return undefined;
  return { sourceUrl: sourceUrl ?? null, ...(author && { author }), publicSharingBlocked: false };
}
