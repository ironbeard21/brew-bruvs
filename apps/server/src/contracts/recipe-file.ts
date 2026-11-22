// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "@hono/zod-openapi";
import { Beverage, CreditInput, RecipeVersionInput } from "./recipes.ts";

export const RecipeFileFormat = z.enum(["beerxml", "beerjson"]);

export const RecipeFile = RecipeVersionInput.pick({
  name: true,
  batchSizeL: true,
  styleId: true,
  content: true,
})
  .extend({
    beverage: Beverage,
    credit: CreditInput.optional(),
  })
  .openapi("RecipeFile");

export const ImportedRecipeDraft = RecipeFile.extend({
  visibility: z.literal("private"),
}).openapi("ImportedRecipeDraft", {
  description: "Review this draft before saving it as a recipe.",
});

export type RecipeFile = z.infer<typeof RecipeFile>;
export type RecipeFileFormat = z.infer<typeof RecipeFileFormat>;
