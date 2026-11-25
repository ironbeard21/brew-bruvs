// SPDX-License-Identifier: AGPL-3.0-or-later
import { type Db, schema } from "@brew-bruvs/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { hashSecret, newSecret } from "../auth/secrets.ts";
import { type DeviceInput, DeviceKind, TiltColor } from "../contracts/device-readings.ts";
import { ApiError } from "../errors.ts";
import { matchesTilt, parseDeviceReading } from "../integrations/device-payload.ts";
import type { User } from "../permissions.ts";
import { denied, ownerOf, signedIn, type Tx } from "./access.ts";
import { recordReading } from "./readings.ts";

const { batches, integrations } = schema;
const storedDeviceKinds = ["ispindel", "tilt", "rapt"] as const;
type Integration = typeof integrations.$inferSelect;

export async function moveBatchDevices(tx: Tx, batchId: string, breweryId: string) {
  await tx
    .update(integrations)
    .set({ ownerUserId: null, ownerBreweryId: breweryId })
    .where(and(eq(integrations.batchId, batchId), inArray(integrations.kind, storedDeviceKinds)));
}

function kindOf(row: Integration) {
  return DeviceKind.parse(
    row.kind === "ispindel" && (row.config as { gravitymon?: boolean }).gravitymon
      ? "gravitymon"
      : row.kind,
  );
}
function colorOf(row: Integration) {
  const color = TiltColor.safeParse((row.config as { tiltColor?: unknown }).tiltColor);
  return color.success ? color.data : null;
}
function view(row: Integration) {
  return {
    id: row.id,
    name: row.name,
    kind: kindOf(row),
    batchId: row.batchId,
    tiltColor: colorOf(row),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}
function invalidToken(): never {
  throw new ApiError(401, "invalid_device_token", "Invalid or revoked device token");
}

function checkOwner(viewer: User, row: Integration | typeof batches.$inferSelect, label: string) {
  const error = denied(
    viewer,
    "edit",
    { owner: ownerOf(row), visibility: "private", shares: [] },
    label,
  );
  if (error) throw error;
}

async function manage(tx: Tx, viewer: User, id: string) {
  const [row] = await tx
    .select()
    .from(integrations)
    .where(and(eq(integrations.id, id), inArray(integrations.kind, storedDeviceKinds)))
    .for("update");
  if (!row) throw new ApiError(404, "not_found", "Device integration not found");
  checkOwner(viewer, row, "Device integration");
  return row;
}

export function createDeviceService(db: Db, { baseUrl }: { baseUrl: string }) {
  function issued(row: Integration, token: string) {
    return { ...view(row), url: `${baseUrl}/api/device-readings?token=${token}` };
  }

  return {
    async list(viewer: User | null) {
      const user = signedIn(viewer);
      const breweries = user.memberships.map((m) => m.breweryId);
      const rows = await db
        .select()
        .from(integrations)
        .where(
          and(
            inArray(integrations.kind, storedDeviceKinds),
            or(
              eq(integrations.ownerUserId, user.id),
              breweries.length ? inArray(integrations.ownerBreweryId, breweries) : undefined,
            ),
          ),
        )
        .orderBy(asc(integrations.name), asc(integrations.id));
      return { items: rows.map(view) };
    },

    async create(viewer: User | null, input: DeviceInput) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        const [batch] = await tx
          .select()
          .from(batches)
          .where(eq(batches.id, input.batchId))
          .for("share");
        if (!batch) throw new ApiError(404, "not_found", "Batch not found");
        checkOwner(user, batch, "Batch");
        const token = newSecret();
        const [row] = await tx
          .insert(integrations)
          .values({
            name: input.name,
            batchId: batch.id,
            ownerUserId: batch.ownerUserId,
            ownerBreweryId: batch.ownerBreweryId,
            kind: input.kind === "gravitymon" ? "ispindel" : input.kind,
            config: { gravitymon: input.kind === "gravitymon", tiltColor: input.tiltColor },
            tokenHash: hashSecret(token),
          })
          .returning();
        if (!row) throw new Error("Device insert returned no row");
        return issued(row, token);
      });
    },

    async rotate(viewer: User | null, id: string) {
      const user = signedIn(viewer);
      return db.transaction(async (tx) => {
        await manage(tx, user, id);
        const token = newSecret();
        const [row] = await tx
          .update(integrations)
          .set({ tokenHash: hashSecret(token) })
          .where(eq(integrations.id, id))
          .returning();
        if (!row) throw new Error("Device update returned no row");
        return issued(row, token);
      });
    },

    async revoke(viewer: User | null, id: string) {
      const user = signedIn(viewer);
      await db.transaction(async (tx) => {
        await manage(tx, user, id);
        await tx.delete(integrations).where(eq(integrations.id, id));
      });
    },

    async ingest(token: string, payload: unknown, count: (tokenHash: string) => void) {
      const tokenHash = hashSecret(token);
      const identity = and(
        eq(integrations.tokenHash, tokenHash),
        inArray(integrations.kind, storedDeviceKinds),
      );
      const [link] = await db
        .select({ batchId: integrations.batchId })
        .from(integrations)
        .where(identity);
      if (!link?.batchId) invalidToken();
      const batchId = link.batchId;

      await db.transaction(async (tx) => {
        // Lock the batch first so its ownership cannot change during delivery.
        const [batch] = await tx.select().from(batches).where(eq(batches.id, batchId)).for("share");
        const [device] = await tx.select().from(integrations).where(identity).for("update");
        if (
          !batch ||
          !device ||
          device.batchId !== batch.id ||
          device.ownerUserId !== batch.ownerUserId ||
          device.ownerBreweryId !== batch.ownerBreweryId
        ) {
          invalidToken();
        }
        count(tokenHash);
        const color = colorOf(device);
        if (color && !matchesTilt(payload, color)) return;
        const now = new Date();
        await recordReading(tx, batch, parseDeviceReading(kindOf(device), payload, now), null);
        await tx
          .update(integrations)
          .set({ lastSeenAt: now })
          .where(eq(integrations.id, device.id));
      });
    },
  };
}

export type DeviceService = ReturnType<typeof createDeviceService>;
