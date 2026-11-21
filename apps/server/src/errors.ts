// SPDX-License-Identifier: AGPL-3.0-or-later
// The one error shape every API response uses: { error: { code, message } }.
import { z } from "@hono/zod-openapi";

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string().openapi({ example: "Not found" }),
    }),
  })
  .openapi("Error");

export type ErrorBody = z.infer<typeof ErrorSchema>;

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}
