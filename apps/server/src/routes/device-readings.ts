// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { type AppEnv, requireSession } from "../auth/middleware.ts";
import { enforce, RateLimiter } from "../auth/rate-limit.ts";
import { Device, DeviceInput, IssuedDevice } from "../contracts/device-readings.ts";
import { errorBody, errorResponses } from "../errors.ts";
import { deviceBody } from "../integrations/device-payload.ts";
import type { DeviceService } from "../services/device-readings.ts";
import { body, json } from "./auth.ts";

const common = {
  tags: ["device readings"],
  security: [{ bearerAuth: [] }, { sessionCookie: [] }],
} satisfies Pick<RouteConfig, "tags" | "security">;

const integrationsPath = "/api/integrations/devices";
const params = z.object({ id: z.uuid() });
const result = z.object({ result: z.literal("success") });

const routes = {
  list: createRoute({
    ...common,
    method: "get",
    path: integrationsPath,
    operationId: "listDevices",
    responses: {
      200: json(z.object({ items: z.array(Device) }), "Device integrations"),
      ...errorResponses(401),
    },
  }),
  create: createRoute({
    ...common,
    method: "post",
    path: integrationsPath,
    operationId: "createDevice",
    request: body(DeviceInput),
    responses: { 201: json(IssuedDevice, "Issued"), ...errorResponses(400, 401, 403, 404) },
  }),
  rotate: createRoute({
    ...common,
    method: "post",
    path: "/api/integrations/devices/{id}/rotate",
    operationId: "rotateDeviceToken",
    request: { params },
    responses: { 200: json(IssuedDevice, "Issued"), ...errorResponses(400, 401, 403, 404) },
  }),
  revoke: createRoute({
    ...common,
    method: "delete",
    path: "/api/integrations/devices/{id}",
    operationId: "revokeDevice",
    request: { params },
    responses: { 204: { description: "Revoked" }, ...errorResponses(400, 401, 403, 404) },
  }),
  ingest: createRoute({
    tags: common.tags,
    method: "post",
    path: "/api/device-readings",
    operationId: "ingestDeviceReading",
    summary: "Log a reading using the issued device URL",
    middleware: [
      bodyLimit({
        maxSize: 16 * 1024,
        onError: (c) => c.json(errorBody("request_too_large", "Device payload is too large"), 413),
      }),
    ],
    request: {
      query: z.object({ token: z.string().regex(/^bb_[A-Za-z0-9_-]{43}$/) }),
      body: {
        required: true,
        content: {
          "application/json": { schema: z.looseObject({}) },
          "application/x-www-form-urlencoded": { schema: z.record(z.string(), z.string()) },
        },
      },
    },
    responses: { 200: json(result, "Reading logged"), ...errorResponses(400, 401, 413, 429) },
  }),
};

export function registerDeviceRoutes(app: OpenAPIHono<AppEnv>, devices: DeviceService) {
  const limit = new RateLimiter(12, 60_000);
  app.openapi(routes.list, async (c) => c.json(await devices.list(requireSession(c).user), 200));
  app.openapi(routes.create, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await devices.create(requireSession(c).user, c.req.valid("json")), 201);
  });
  app.openapi(routes.rotate, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await devices.rotate(requireSession(c).user, c.req.valid("param").id), 200);
  });
  app.openapi(routes.revoke, async (c) => {
    await devices.revoke(requireSession(c).user, c.req.valid("param").id);
    return c.body(null, 204);
  });
  app.openapi(routes.ingest, async (c) => {
    const contentType = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const payload = deviceBody(await c.req.text(), contentType);
    await devices.ingest(c.req.valid("query").token, payload, (hash) => {
      enforce(c, limit, hash);
      limit.hit(hash);
    });
    return c.json({ result: "success" as const }, 200);
  });
}
