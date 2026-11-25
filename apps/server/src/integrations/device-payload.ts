// SPDX-License-Identifier: AGPL-3.0-or-later
import { units } from "@brew-bruvs/brew-math";
import { z } from "zod";
import { ReadingInput } from "../contracts/batches.ts";
import type { DeviceInput } from "../contracts/device-readings.ts";
import { ApiError } from "../errors.ts";

const decimal = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/)
      .transform(Number),
  ])
  .pipe(z.number());

const unit = z.string().trim().toLowerCase().optional();
const nativeTilt = z.object({ SG: decimal.optional(), Temp: decimal.optional() });
const tiltIdentity = z.object({ Color: z.string().optional(), name: z.string().optional() });
const telemetry = z.object({
  gravity: decimal.optional(),
  "corr-gravity": decimal.optional(),
  "gravity-unit": unit,
  gravity_unit: unit,
  temperature: decimal.optional(),
  temp: decimal.optional(),
  "temp-units": unit,
  temp_units: unit,
  temp_unit: unit,
});

function invalid(message: string): never {
  throw new ApiError(400, "invalid_device_reading", message);
}

export function deviceBody(text: string, contentType: string) {
  try {
    if (contentType === "application/x-www-form-urlencoded") {
      const fields = new URLSearchParams(text);
      if (fields.size !== new Set(fields.keys()).size) invalid("Repeated device fields");
      return Object.fromEntries(fields);
    }
    // Some firmware sends JSON as text/plain or omits the Content-Type.
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    invalid("Invalid device payload");
  }
}

export function matchesTilt(payload: unknown, color: string) {
  const parsed = tiltIdentity.safeParse(payload);
  if (!parsed.success) return false;
  const label = parsed.data.Color ?? parsed.data.name;
  return label?.split(":")[0]?.trim().toLowerCase() === color;
}

export function parseDeviceReading(kind: DeviceInput["kind"], payload: unknown, takenAt: Date) {
  let gravitySg: number | undefined;
  let temperatureC: number | undefined;
  if (
    kind === "tilt" &&
    payload &&
    typeof payload === "object" &&
    ("SG" in payload || "Temp" in payload)
  ) {
    const parsed = nativeTilt.safeParse(payload);
    if (!parsed.success) invalid("Invalid Tilt fields");
    gravitySg = parsed.data.SG;
    temperatureC = parsed.data.Temp === undefined ? undefined : units.fToC(parsed.data.Temp);
  } else {
    const parsed = telemetry.safeParse(payload);
    if (!parsed.success) invalid("Invalid telemetry fields");
    const data = parsed.data;
    const gravity = kind === "gravitymon" ? (data["corr-gravity"] ?? data.gravity) : data.gravity;
    const gravityUnit =
      data["gravity-unit"] ?? data.gravity_unit ?? (kind === "ispindel" ? "p" : "g");
    if (gravity !== undefined) {
      switch (gravityUnit) {
        case "sg":
        case "g":
          gravitySg = gravity;
          break;
        case "p":
        case "plato":
          gravitySg = units.platoToSg(gravity);
          break;
        case "sg1000":
          gravitySg = units.milliSgToSg(gravity);
          break;
        default:
          invalid("Unsupported gravity unit");
      }
    }
    const temperature = data.temperature ?? data.temp;
    const temperatureUnit =
      data["temp-units"] ?? data.temp_units ?? data.temp_unit ?? (kind === "tilt" ? "f" : "c");
    if (temperature !== undefined) {
      if (temperatureUnit !== "c" && temperatureUnit !== "f")
        invalid("Unsupported temperature unit");
      temperatureC = temperatureUnit === "f" ? units.fToC(temperature) : temperature;
    }
  }

  const reading = ReadingInput.safeParse({
    gravitySg,
    temperatureC,
    takenAt: takenAt.toISOString(),
    source: "device",
  });
  if (!reading.success) invalid("Give an in-range gravity or temperature");
  return reading.data;
}
