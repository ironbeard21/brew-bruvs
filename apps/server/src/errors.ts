// SPDX-License-Identifier: AGPL-3.0-or-later
// The one error shape every API response uses: { error: { code, message } }.
import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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

/** Throw from services or handlers; the app turns it into the error format above. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** OpenAPI response entries for the error statuses a route can return. */
export function errorResponses<S extends number>(...statuses: S[]) {
  const content = { "application/json": { schema: ErrorSchema } };
  return Object.fromEntries(statuses.map((s) => [s, { description: "Error", content }])) as Record<
    S,
    { description: string; content: typeof content }
  >;
}
