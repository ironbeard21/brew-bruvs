// SPDX-License-Identifier: AGPL-3.0-or-later
// Notes on a batch, a recipe, or on their own; tasting notes add optional BJCP scores.
import { type Db, schema } from "@brew-bruvs/db";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { NoteInput, NotePatch, TastingScores } from "../contracts/batches.ts";
import { ApiError } from "../errors.ts";
import type { Action, User } from "../permissions.ts";
import { authorizeRow, newId, newOwner, ownerOf, readableBy, signedIn, type Tx } from "./access.ts";

const { notes, recipes, batches, shares } = schema;
type NoteRow = typeof notes.$inferSelect;
type Scores = z.infer<typeof TastingScores>;

const SCORE_COLUMNS = {
  aroma: "scoreAroma",
  appearance: "scoreAppearance",
  flavor: "scoreFlavor",
  mouthfeel: "scoreMouthfeel",
  overall: "scoreOverall",
} as const;

/** Score fields as columns; keys left out of `scores` are left out here too. */
function scoreColumns(scores: Scores | undefined) {
  const out: Partial<Record<(typeof SCORE_COLUMNS)[keyof Scores], number | null>> = {};
  for (const [key, column] of Object.entries(SCORE_COLUMNS) as [keyof Scores, string][]) {
    const value = scores?.[key];
    if (value !== undefined) out[column as (typeof SCORE_COLUMNS)[keyof Scores]] = value;
  }
  return out;
}

function view(row: NoteRow) {
  const owner = ownerOf(row);
  let scores = null;
  if (row.kind === "tasting") {
    const values = {
      aroma: row.scoreAroma,
      appearance: row.scoreAppearance,
      flavor: row.scoreFlavor,
      mouthfeel: row.scoreMouthfeel,
      overall: row.scoreOverall,
    };
    const given = Object.values(values).filter((v) => v !== null);
    scores = { ...values, total: given.length ? given.reduce((a, b) => a + b, 0) : null };
  }
  return {
    id: row.id,
    uri: row.uri,
    kind: row.kind,
    body: row.body,
    recipeId: row.recipeId,
    batchId: row.batchId,
    scores,
    visibility: row.visibility,
    owner: owner as NonNullable<typeof owner>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createNoteService(db: Db, opts: { baseUrl: string }) {
  async function authorize(tx: Tx, user: User | null, action: Action, id: string) {
    const [row] = await tx.select().from(notes).where(eq(notes.id, id));
    if (!row) throw new ApiError(404, "not_found", "Note not found");
    await authorizeRow(tx, user, action, "note", row, "Note");
    return row;
  }

  return {
    /** Readable notes, newest first; filter to one recipe's or batch's notes. */
    async list(
      viewer: User | null,
      page: {
        recipeId?: string | undefined;
        batchId?: string | undefined;
        limit: number;
        offset: number;
      },
    ) {
      const rows = await db
        .select()
        .from(notes)
        .where(
          and(
            readableBy(db, viewer, "note", notes),
            page.recipeId ? eq(notes.recipeId, page.recipeId) : undefined,
            page.batchId ? eq(notes.batchId, page.batchId) : undefined,
          ),
        )
        .orderBy(desc(notes.createdAt), desc(notes.id))
        .limit(page.limit + 1)
        .offset(page.offset);
      return {
        items: rows.slice(0, page.limit).map(view),
        nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
      };
    },

    /** A note about something needs read access to it; the note itself is yours and private. */
    async create(viewer: User | null, input: z.infer<typeof NoteInput>) {
      const user = signedIn(viewer);
      const owner = newOwner(user, input.breweryId);
      return db.transaction(async (tx) => {
        if (input.recipeId) {
          const [recipe] = await tx.select().from(recipes).where(eq(recipes.id, input.recipeId));
          if (!recipe) throw new ApiError(404, "not_found", "Recipe not found");
          await authorizeRow(tx, user, "read", "recipe", recipe, "Recipe");
        }
        if (input.batchId) {
          const [batch] = await tx.select().from(batches).where(eq(batches.id, input.batchId));
          if (!batch) throw new ApiError(404, "not_found", "Batch not found");
          await authorizeRow(tx, user, "read", "batch", batch, "Batch");
        }
        const id = await newId(tx);
        const [row] = await tx
          .insert(notes)
          .values({
            id,
            uri: `${opts.baseUrl}/notes/${id}`,
            ...owner,
            kind: input.kind,
            body: input.body,
            recipeId: input.recipeId ?? null,
            batchId: input.batchId ?? null,
            ...scoreColumns(input.scores),
          })
          .returning();
        return view(row as NoteRow);
      });
    },

    async get(viewer: User | null, id: string) {
      return view(await authorize(db, viewer, "read", id));
    },

    async update(viewer: User | null, id: string, patch: z.infer<typeof NotePatch>) {
      return db.transaction(async (tx) => {
        const current = await authorize(tx, viewer, "edit", id);
        if (patch.scores && current.kind !== "tasting") {
          throw new ApiError(400, "validation_error", "Only tasting notes have scores");
        }
        const set = {
          ...(patch.body === undefined ? {} : { body: patch.body }),
          ...scoreColumns(patch.scores),
        };
        if (Object.keys(set).length === 0) return view(current);
        const [row] = await tx.update(notes).set(set).where(eq(notes.id, id)).returning();
        return view(row as NoteRow);
      });
    },

    async remove(viewer: User | null, id: string) {
      await db.transaction(async (tx) => {
        await authorize(tx, viewer, "delete", id);
        await tx
          .delete(shares)
          .where(and(eq(shares.resourceType, "note"), eq(shares.resourceId, id)));
        await tx.delete(notes).where(eq(notes.id, id));
      });
    },
  };
}

export type NoteService = ReturnType<typeof createNoteService>;
