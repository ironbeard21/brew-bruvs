// SPDX-License-Identifier: AGPL-3.0-or-later
import { z } from "@hono/zod-openapi";

export const DeviceKind = z.enum(["ispindel", "gravitymon", "tilt", "rapt"]);
export const TiltColor = z.enum([
  "red",
  "green",
  "black",
  "purple",
  "orange",
  "blue",
  "yellow",
  "pink",
]);

export const DeviceInput = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    kind: DeviceKind,
    batchId: z.uuid(),
    tiltColor: TiltColor.optional().openapi({
      description: "Select one Tilt from a shared bridge.",
    }),
  })
  .refine((input) => input.kind === "tilt" || input.tiltColor === undefined, {
    message: "Color applies only to Tilt devices",
    path: ["tiltColor"],
  })
  .openapi("DeviceInput");

export const Device = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: DeviceKind,
    batchId: z.uuid().nullable(),
    tiltColor: TiltColor.nullable(),
    lastSeenAt: z.string().nullable(),
  })
  .openapi("Device");

export const IssuedDevice = Device.extend({
  url: z
    .url()
    .openapi({ description: "Device upload URL. Keep it secret; shown only when issued." }),
}).openapi("IssuedDevice");

export type DeviceInput = z.infer<typeof DeviceInput>;
