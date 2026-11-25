// SPDX-License-Identifier: AGPL-3.0-or-later
import { schema } from "@brew-bruvs/db";
import type { z } from "zod";
import type { ReadingInput } from "../contracts/batches.ts";
import type { Tx } from "./access.ts";
import { recordActivity } from "./activity.ts";

const { readings } = schema;

export async function recordReading(
  tx: Tx,
  batch: { id: string; ownerBreweryId: string | null },
  input: z.infer<typeof ReadingInput>,
  actorUserId: string | null,
) {
  const [row] = await tx
    .insert(readings)
    .values({
      ...input,
      takenAt: new Date(input.takenAt),
      batchId: batch.id,
      createdByUserId: actorUserId,
    })
    .returning();
  if (!row) throw new Error("Reading insert returned no row");
  await recordActivity(tx, {
    breweryId: batch.ownerBreweryId,
    actorUserId,
    verb: "reading_logged",
    objectType: "reading",
    objectId: row.id,
  });
  return row;
}
