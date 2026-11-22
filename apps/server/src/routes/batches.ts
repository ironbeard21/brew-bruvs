// SPDX-License-Identifier: AGPL-3.0-or-later
// Batches, status moves, readings, reminders and notes.
// Reads allow anonymous visitors where visibility permits; everything else needs a session.
import { createRoute, type OpenAPIHono, type RouteConfig, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppEnv } from "../auth/middleware.ts";
import {
  BatchDetail,
  BatchPage,
  BatchStatus,
  CreateBatch,
  Note,
  NoteInput,
  NotePage,
  NotePatch,
  Reading,
  ReadingInput,
  ReadingPatch,
  Reminder,
  ReminderInput,
  StatusChange,
  StatusResult,
} from "../contracts/batches.ts";
import { errorResponses } from "../errors.ts";
import type { BatchService } from "../services/batches.ts";
import type { NoteService } from "../services/notes.ts";
import { body, json } from "./auth.ts";
import { parseDecimal } from "./recipes.ts";

const security = [{ bearerAuth: [] }, { sessionCookie: [] }];
const tagged = (tag: string) =>
  ({ tags: [tag], security }) satisfies Pick<RouteConfig, "tags" | "security">;
const batch = tagged("batches");
const note = tagged("notes");
const id = z.object({ id: z.uuid() });
const readingId = z.object({ id: z.uuid(), readingId: z.uuid() });
const noContent = { description: "Done" };
const paging = {
  limit: z.preprocess(parseDecimal, z.int().min(1).max(100)).default(25),
  offset: z.preprocess(parseDecimal, z.int().nonnegative().max(2_147_483_647)).default(0),
};

const routes = {
  list: createRoute({
    ...batch,
    method: "get",
    path: "/api/batches",
    operationId: "listBatches",
    summary: "Batches you can read, most recently changed first",
    request: {
      query: z.strictObject({
        status: BatchStatus.optional(),
        mine: z
          .enum(["true", "false"])
          .default("false")
          .transform((v) => v === "true")
          .openapi({ description: "Only batches you own" }),
        ...paging,
      }),
    },
    responses: { 200: json(BatchPage, "Batches"), ...errorResponses(400, 401) },
  }),
  create: createRoute({
    ...batch,
    method: "post",
    path: "/api/batches",
    operationId: "createBatch",
    summary: "Start a planned batch from a recipe version you can read",
    request: body(CreateBatch),
    responses: { 201: json(BatchDetail, "Created"), ...errorResponses(400, 401, 404) },
  }),
  get: createRoute({
    ...batch,
    method: "get",
    path: "/api/batches/{id}",
    operationId: "getBatch",
    summary: "A batch with its status history and the moves it can make",
    request: { params: id },
    responses: { 200: json(BatchDetail, "Batch"), ...errorResponses(400, 404) },
  }),
  delete: createRoute({
    ...batch,
    method: "delete",
    path: "/api/batches/{id}",
    operationId: "deleteBatch",
    summary: "Delete a batch with its readings, reminders, history and notes",
    request: { params: id },
    responses: { 204: noContent, ...errorResponses(400, 401, 403, 404) },
  }),
  status: createRoute({
    ...batch,
    method: "post",
    path: "/api/batches/{id}/status",
    operationId: "setBatchStatus",
    summary:
      "Move to any later status of the batch's beverage, or one step back. A mead moving to primary gets its nutrient reminders.",
    request: { params: id, ...body(StatusChange) },
    responses: { 200: json(StatusResult, "Moved"), ...errorResponses(400, 401, 403, 404, 409) },
  }),
  readings: createRoute({
    ...batch,
    method: "get",
    path: "/api/batches/{id}/readings",
    operationId: "listReadings",
    summary: "Readings in time order",
    request: { params: id },
    responses: { 200: json(z.array(Reading), "Readings"), ...errorResponses(400, 404) },
  }),
  addReading: createRoute({
    ...batch,
    method: "post",
    path: "/api/batches/{id}/readings",
    operationId: "addReading",
    summary: "Log a reading",
    request: { params: id, ...body(ReadingInput) },
    responses: { 201: json(Reading, "Added"), ...errorResponses(400, 401, 403, 404) },
  }),
  updateReading: createRoute({
    ...batch,
    method: "patch",
    path: "/api/batches/{id}/readings/{readingId}",
    operationId: "updateReading",
    summary: "Correct a reading",
    request: { params: readingId, ...body(ReadingPatch) },
    responses: { 200: json(Reading, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
  deleteReading: createRoute({
    ...batch,
    method: "delete",
    path: "/api/batches/{id}/readings/{readingId}",
    operationId: "deleteReading",
    summary: "Delete a reading",
    request: { params: readingId },
    responses: { 204: noContent, ...errorResponses(400, 401, 403, 404) },
  }),
  reminders: createRoute({
    ...batch,
    method: "get",
    path: "/api/batches/{id}/reminders",
    operationId: "listBatchReminders",
    summary: "A batch's reminders, done or not, soonest first",
    request: { params: id },
    responses: { 200: json(z.array(Reminder), "Reminders"), ...errorResponses(400, 404) },
  }),
  addReminder: createRoute({
    ...batch,
    method: "post",
    path: "/api/batches/{id}/reminders",
    operationId: "addReminder",
    summary: "Add a reminder",
    request: { params: id, ...body(ReminderInput) },
    responses: { 201: json(Reminder, "Added"), ...errorResponses(400, 401, 403, 404) },
  }),
  due: createRoute({
    ...batch,
    method: "get",
    path: "/api/reminders",
    operationId: "listDueReminders",
    summary:
      "Open reminders due by `until` (default now) on your own and shared batches; the app schedules them as local notifications",
    request: { query: z.strictObject({ until: z.iso.datetime({ offset: true }).optional() }) },
    responses: { 200: json(z.array(Reminder), "Due reminders"), ...errorResponses(400, 401) },
  }),
  done: createRoute({
    ...batch,
    method: "post",
    path: "/api/reminders/{id}/done",
    operationId: "markReminderDone",
    summary: "Mark a reminder done (again is fine)",
    request: { params: id },
    responses: { 200: json(Reminder, "Done"), ...errorResponses(400, 401, 403, 404) },
  }),

  notes: createRoute({
    ...note,
    method: "get",
    path: "/api/notes",
    operationId: "listNotes",
    summary: "Notes you can read, newest first; filter by recipe or batch",
    request: {
      query: z.strictObject({
        recipeId: z.uuid().optional(),
        batchId: z.uuid().optional(),
        ...paging,
      }),
    },
    responses: { 200: json(NotePage, "Notes"), ...errorResponses(400) },
  }),
  addNote: createRoute({
    ...note,
    method: "post",
    path: "/api/notes",
    operationId: "createNote",
    summary: "Write a note on a recipe, a batch, or on its own; tasting notes can have scores",
    request: body(NoteInput),
    responses: { 201: json(Note, "Created"), ...errorResponses(400, 401, 404) },
  }),
  getNote: createRoute({
    ...note,
    method: "get",
    path: "/api/notes/{id}",
    operationId: "getNote",
    summary: "One note",
    request: { params: id },
    responses: { 200: json(Note, "Note"), ...errorResponses(400, 404) },
  }),
  updateNote: createRoute({
    ...note,
    method: "patch",
    path: "/api/notes/{id}",
    operationId: "updateNote",
    summary: "Change a note's text or scores",
    request: { params: id, ...body(NotePatch) },
    responses: { 200: json(Note, "Updated"), ...errorResponses(400, 401, 403, 404) },
  }),
  deleteNote: createRoute({
    ...note,
    method: "delete",
    path: "/api/notes/{id}",
    operationId: "deleteNote",
    summary: "Delete a note",
    request: { params: id },
    responses: { 204: noContent, ...errorResponses(400, 401, 403, 404) },
  }),
};

const viewer = (c: Context<AppEnv>) => c.get("session")?.user ?? null;

export function registerBatchRoutes(
  app: OpenAPIHono<AppEnv>,
  deps: { batches: BatchService; notes: NoteService },
) {
  const { batches, notes } = deps;
  const param = <T extends { req: { valid(t: "param"): { id: string } } }>(c: T) =>
    c.req.valid("param").id;

  app.openapi(routes.list, async (c) =>
    c.json(await batches.list(viewer(c), c.req.valid("query")), 200),
  );
  app.openapi(routes.create, async (c) =>
    c.json(await batches.create(viewer(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.get, async (c) => c.json(await batches.get(viewer(c), param(c)), 200));
  app.openapi(routes.delete, async (c) => {
    await batches.remove(viewer(c), param(c));
    return c.body(null, 204);
  });
  app.openapi(routes.status, async (c) =>
    c.json(await batches.setStatus(viewer(c), param(c), c.req.valid("json").status), 200),
  );
  app.openapi(routes.readings, async (c) =>
    c.json(await batches.readings(viewer(c), param(c)), 200),
  );
  app.openapi(routes.addReading, async (c) =>
    c.json(await batches.addReading(viewer(c), param(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.updateReading, async (c) => {
    const p = c.req.valid("param");
    return c.json(
      await batches.updateReading(viewer(c), p.id, p.readingId, c.req.valid("json")),
      200,
    );
  });
  app.openapi(routes.deleteReading, async (c) => {
    const p = c.req.valid("param");
    await batches.removeReading(viewer(c), p.id, p.readingId);
    return c.body(null, 204);
  });
  app.openapi(routes.reminders, async (c) =>
    c.json(await batches.reminders(viewer(c), param(c)), 200),
  );
  app.openapi(routes.addReminder, async (c) =>
    c.json(await batches.addReminder(viewer(c), param(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.due, async (c) => {
    const { until } = c.req.valid("query");
    return c.json(await batches.due(viewer(c), until ? new Date(until) : new Date()), 200);
  });
  app.openapi(routes.done, async (c) => c.json(await batches.markDone(viewer(c), param(c)), 200));

  app.openapi(routes.notes, async (c) =>
    c.json(await notes.list(viewer(c), c.req.valid("query")), 200),
  );
  app.openapi(routes.addNote, async (c) =>
    c.json(await notes.create(viewer(c), c.req.valid("json")), 201),
  );
  app.openapi(routes.getNote, async (c) => c.json(await notes.get(viewer(c), param(c)), 200));
  app.openapi(routes.updateNote, async (c) =>
    c.json(await notes.update(viewer(c), param(c), c.req.valid("json")), 200),
  );
  app.openapi(routes.deleteNote, async (c) => {
    await notes.remove(viewer(c), param(c));
    return c.body(null, 204);
  });
}
