import "server-only";
import type { NoteTone, PersonalNote, WorkspaceRole } from "@prisma/client";
import { z } from "zod";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { prisma, type DbClient } from "@/lib/db";
import { htmlToText, sanitizeDocHtml } from "@/lib/docs/sanitize";
import { publishToUser } from "@/lib/realtime";
import { canContribute } from "@/lib/roles";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { createTask } from "@/lib/tasks/service";
import { isDay, positionBetween, todayIn } from "./dates";
import { NOTE_CONFLICT } from "./saving";
import { noteDTO, todoDTO } from "./mappers";

/**
 * The personal notepad: private notes and to-dos for one member in one
 * workspace. Every read and write is scoped to (workspaceId, userId) of the
 * signed-in member, so nobody else can see them, admins included. Notes are
 * indexed for search as PRIVATE to their owner (the search reader also
 * refuses `note` entries to anyone but the owner).
 */

export type NotepadActor = {
  user: { id: string; name: string | null };
  workspace: { id: string; slug: string; name: string; timezone: string };
  membership: { role: WorkspaceRole };
};

export const NOTE_TONES = ["PLAIN", "CITRON", "SKY", "YELLOW", "ORANGE", "TEAL"] as const satisfies readonly NoteTone[];
const MAX_NOTES = 500;
const MAX_OPEN_TODOS = 1000;
const MAX_NOTE_HTML = 200_000;
const DONE_VISIBLE_DAYS = 14;

export type NoteDTO = { id: string; title: string; contentHtml: string; excerpt: string; tone: NoteTone; pinned: boolean; archived: boolean; checklist: { done: number; total: number }; updatedAt: string };
export type TodoDTO = { id: string; text: string; done: boolean; doneAt: string | null; dueOn: string | null; starred: boolean; position: number; noteId: string | null; taskId: string | null; taskUrl: string | null };
export type NotepadData = { today: string; notes: NoteDTO[]; archivedNotes: NoteDTO[]; todos: TodoDTO[] };

const id = z.string().min(1).max(64);
const tone = z.enum(NOTE_TONES);
const dayOrNull = z.union([z.string().refine(isDay, "Pick a valid date."), z.null()]);


const mine = (actor: NotepadActor) => ({ workspaceId: actor.workspace.id, userId: actor.user.id });
const dayToDate = (day: string | null) => (day ? new Date(`${day}T00:00:00Z`) : null);

function changed(actor: NotepadActor) {
  // Other open tabs of the same member refresh; nobody else is told.
  void publishToUser(actor.workspace.id, actor.user.id, { type: "notepad.changed" });
}

async function indexNote(actor: NotepadActor, note: PersonalNote, client: DbClient = prisma) {
  if (note.archivedAt || (!note.title.trim() && !note.contentText.trim())) {
    await removeSearchDocument("note", note.id, client);
    return;
  }
  await indexSearchDocument({
    workspaceId: actor.workspace.id,
    entityType: "note",
    entityId: note.id,
    title: note.title.trim() || note.contentText.slice(0, 80),
    body: note.contentText.slice(0, 4000),
    visibility: "PRIVATE",
    ownerId: actor.user.id,
    url: `/w/${actor.workspace.slug}/notepad?note=${note.id}`,
  }, client);
}

/* ---------- Reads ---------- */

export async function getNotepad(actor: NotepadActor, now = new Date()): Promise<NotepadData> {
  const doneSince = new Date(now.getTime() - DONE_VISIBLE_DAYS * 86_400_000);
  const [notes, todos] = await Promise.all([
    prisma.personalNote.findMany({ where: mine(actor), orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: MAX_NOTES }),
    prisma.personalTodo.findMany({
      where: { ...mine(actor), OR: [{ done: false }, { doneAt: { gte: doneSince } }] },
      orderBy: [{ done: "asc" }, { position: "asc" }],
      take: MAX_OPEN_TODOS + 200,
    }),
  ]);
  const taskIds = todos.map((todo) => todo.taskId).filter((value): value is string => Boolean(value));
  const tasks = taskIds.length
    ? await prisma.task.findMany({ where: { id: { in: taskIds }, workspaceId: actor.workspace.id }, select: { id: true, number: true, project: { select: { key: true } } } })
    : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return {
    today: todayIn(actor.workspace.timezone, now),
    notes: notes.filter((note) => !note.archivedAt).map(noteDTO),
    archivedNotes: notes.filter((note) => note.archivedAt).map(noteDTO),
    todos: todos.map((todo) => todoDTO({ ...todo, task: todo.taskId ? byId.get(todo.taskId) ?? null : null }, actor.workspace.slug)),
  };
}

/** Counts for the home page ("3 to-dos due today"). */
export async function notepadSummary(actor: NotepadActor, now = new Date()) {
  const today = todayIn(actor.workspace.timezone, now);
  const dueByToday = await prisma.personalTodo.count({ where: { ...mine(actor), done: false, dueOn: { lte: dayToDate(today)! } } });
  return { dueByToday };
}

/* ---------- Notes ---------- */

const createNoteSchema = z.object({ title: z.string().trim().max(200).default(""), contentHtml: z.string().max(MAX_NOTE_HTML).default(""), tone: tone.default("PLAIN") });

export async function createNote(actor: NotepadActor, input: unknown): Promise<ActionResult<NoteDTO>> {
  const parsed = createNoteSchema.safeParse(input ?? {});
  if (!parsed.success) return validationError(parsed.error);
  if ((await prisma.personalNote.count({ where: mine(actor) })) >= MAX_NOTES) return actionError(`You can keep up to ${MAX_NOTES} notes. Delete a few archived ones first.`);
  const html = sanitizeDocHtml(parsed.data.contentHtml);
  const note = await prisma.personalNote.create({ data: { ...mine(actor), title: parsed.data.title, contentHtml: html, contentText: htmlToText(html), tone: parsed.data.tone } });
  await indexNote(actor, note);
  changed(actor);
  return { ok: true, data: noteDTO(note) };
}

const updateNoteSchema = z.object({
  id,
  title: z.string().trim().max(200).optional(),
  contentHtml: z.string().max(MAX_NOTE_HTML).optional(),
  tone: tone.optional(),
  pinned: z.boolean().optional(),
  /** The `updatedAt` the editor loaded; a newer save elsewhere wins and this one is refused. */
  expectedUpdatedAt: z.string().datetime().optional(),
});

export async function updateNote(actor: NotepadActor, input: unknown): Promise<ActionResult<NoteDTO>> {
  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id: noteId, expectedUpdatedAt, contentHtml, ...rest } = parsed.data;
  const existing = await prisma.personalNote.findFirst({ where: { id: noteId, ...mine(actor) } });
  if (!existing) return actionError("That note isn't available.");
  const html = contentHtml === undefined ? undefined : sanitizeDocHtml(contentHtml);
  const note = await prisma.$transaction(async (tx) => {
    const updated = await tx.personalNote.updateMany({
      where: { id: existing.id, ...mine(actor), updatedAt: expectedUpdatedAt ? new Date(expectedUpdatedAt) : existing.updatedAt },
      // Always advance the version, including two writes in the same millisecond.
      data: { ...rest, ...(html === undefined ? {} : { contentHtml: html, contentText: htmlToText(html) }), updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)) },
    });
    if (updated.count === 0) return null;
    const fresh = await tx.personalNote.findUniqueOrThrow({ where: { id: existing.id } });
    await indexNote(actor, fresh, tx);
    return fresh;
  });
  if (!note) return actionError(NOTE_CONFLICT);
  changed(actor);
  return { ok: true, data: noteDTO(note) };
}

export async function setNoteArchived(actor: NotepadActor, input: unknown): Promise<ActionResult<NoteDTO>> {
  const parsed = z.object({ id, archived: z.boolean() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const existing = await prisma.personalNote.findFirst({ where: { id: parsed.data.id, ...mine(actor) } });
  if (!existing) return actionError("That note isn't available.");
  const note = await prisma.personalNote.update({ where: { id: existing.id }, data: { archivedAt: parsed.data.archived ? new Date() : null, pinned: parsed.data.archived ? false : existing.pinned } });
  await indexNote(actor, note);
  changed(actor);
  return { ok: true, data: noteDTO(note) };
}

export async function deleteNote(actor: NotepadActor, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { count } = await prisma.personalNote.deleteMany({ where: { id: parsed.data.id, ...mine(actor), archivedAt: { not: null } } });
  if (count === 0) return actionError("Archive the note before deleting it.");
  await removeSearchDocument("note", parsed.data.id);
  changed(actor);
  return { ok: true };
}

/* ---------- To-dos ---------- */

const createTodoSchema = z.object({ text: z.string().trim().min(1, "Write the to-do first.").max(500), dueOn: dayOrNull.default(null), starred: z.boolean().default(false), noteId: id.optional() });

export async function createTodo(actor: NotepadActor, input: unknown): Promise<ActionResult<TodoDTO>> {
  const parsed = createTodoSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if ((await prisma.personalTodo.count({ where: { ...mine(actor), done: false } })) >= MAX_OPEN_TODOS) return actionError(`You have ${MAX_OPEN_TODOS} open to-dos. Finish or delete a few first.`);
  if (parsed.data.noteId && !(await prisma.personalNote.findFirst({ where: { id: parsed.data.noteId, ...mine(actor) }, select: { id: true } }))) return actionError("That note isn't available.");
  const first = await prisma.personalTodo.findFirst({ where: { ...mine(actor), done: false }, orderBy: { position: "asc" }, select: { position: true } });
  const todo = await prisma.personalTodo.create({
    data: { ...mine(actor), text: parsed.data.text, dueOn: dayToDate(parsed.data.dueOn), starred: parsed.data.starred, noteId: parsed.data.noteId ?? null, position: positionBetween(null, first?.position ?? null) },
  });
  changed(actor);
  return { ok: true, data: todoDTO(todo, actor.workspace.slug) };
}

const updateTodoSchema = z.object({ id, text: z.string().trim().min(1, "Write the to-do first.").max(500).optional(), dueOn: dayOrNull.optional(), starred: z.boolean().optional(), done: z.boolean().optional() });

export async function updateTodo(actor: NotepadActor, input: unknown): Promise<ActionResult<TodoDTO>> {
  const parsed = updateTodoSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id: todoId, dueOn, done, ...rest } = parsed.data;
  const existing = await prisma.personalTodo.findFirst({ where: { id: todoId, ...mine(actor) } });
  if (!existing) return actionError("That to-do isn't available.");
  const todo = await prisma.personalTodo.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(dueOn === undefined ? {} : { dueOn: dayToDate(dueOn) }),
      ...(done === undefined || done === existing.done ? {} : { done, doneAt: done ? new Date() : null }),
    },
  });
  changed(actor);
  return { ok: true, data: todoDTO(todo, actor.workspace.slug) };
}

/** Move a to-do between two neighbours in the open list (ids from the client's current order). */
export async function moveTodo(actor: NotepadActor, input: unknown): Promise<ActionResult<TodoDTO>> {
  const parsed = z.object({ id, beforeId: id.nullable(), afterId: id.nullable() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const ids = [parsed.data.id, parsed.data.beforeId, parsed.data.afterId].filter((value): value is string => Boolean(value));
  const rows = await prisma.personalTodo.findMany({ where: { id: { in: ids }, ...mine(actor) }, select: { id: true, position: true } });
  const find = (value: string | null) => (value ? rows.find((row) => row.id === value) ?? null : null);
  if (!find(parsed.data.id) || (parsed.data.beforeId && !find(parsed.data.beforeId)) || (parsed.data.afterId && !find(parsed.data.afterId))) return actionError("That to-do isn't available.");
  let position = positionBetween(find(parsed.data.beforeId)?.position ?? null, find(parsed.data.afterId)?.position ?? null);
  if (parsed.data.beforeId && parsed.data.afterId && Math.abs((find(parsed.data.afterId)!.position - find(parsed.data.beforeId)!.position)) < 1e-6) {
    // Neighbours collided: renumber the open list, then retry the midpoint.
    const open = await prisma.personalTodo.findMany({ where: { ...mine(actor), done: false }, orderBy: { position: "asc" }, select: { id: true } });
    await prisma.$transaction(open.map((row, index) => prisma.personalTodo.update({ where: { id: row.id }, data: { position: (index + 1) * 1024 } })));
    const fresh = await prisma.personalTodo.findMany({ where: { id: { in: ids } }, select: { id: true, position: true } });
    position = positionBetween(fresh.find((row) => row.id === parsed.data.beforeId)?.position ?? null, fresh.find((row) => row.id === parsed.data.afterId)?.position ?? null);
  }
  const todo = await prisma.personalTodo.update({ where: { id: parsed.data.id }, data: { position } });
  changed(actor);
  return { ok: true, data: todoDTO(todo, actor.workspace.slug) };
}

export async function deleteTodo(actor: NotepadActor, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { count } = await prisma.personalTodo.deleteMany({ where: { id: parsed.data.id, ...mine(actor) } });
  if (count === 0) return actionError("That to-do isn't available.");
  changed(actor);
  return { ok: true };
}

export async function clearDoneTodos(actor: NotepadActor): Promise<ActionResult<{ cleared: number }>> {
  const { count } = await prisma.personalTodo.deleteMany({ where: { ...mine(actor), done: true } });
  changed(actor);
  return { ok: true, data: { cleared: count } };
}

/**
 * Turn a private to-do into a workspace task assigned to the member (no
 * project, due the same day). The to-do stays, linked to the new task.
 */
export async function sendTodoToTasks(actor: NotepadActor, input: unknown): Promise<ActionResult<TodoDTO>> {
  const parsed = z.object({ id, projectId: id.optional() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!canContribute(actor.membership)) return actionError(NOT_ALLOWED);
  const existing = await prisma.personalTodo.findFirst({ where: { id: parsed.data.id, ...mine(actor) } });
  if (!existing) return actionError("That to-do isn't available.");
  if (existing.taskId) return actionError("This to-do is already a task.");
  const created = await createTask(actor, {
    title: existing.text,
    projectId: parsed.data.projectId ?? null,
    dueDate: existing.dueOn ? existing.dueOn.toISOString().slice(0, 10) : "",
    assigneeIds: [actor.user.id],
    priority: existing.starred ? "HIGH" : "NONE",
  });
  if (!created.ok) return created;
  const todo = await prisma.personalTodo.update({ where: { id: existing.id }, data: { taskId: created.data!.id } });
  changed(actor);
  const task = await prisma.task.findUnique({ where: { id: created.data!.id }, select: { number: true, project: { select: { key: true } } } });
  return { ok: true, data: todoDTO({ ...todo, task }, actor.workspace.slug) };
}
