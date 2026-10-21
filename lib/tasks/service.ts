import "server-only";

import type { Prisma, Project, Task } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { nextWorkspaceSequence } from "@/lib/counters";
import { dispatch } from "@/lib/notify";
import type { EventPayloads, NotificationEvent } from "@/lib/notify";
import { hasRoleAtLeast } from "@/lib/roles";
import { uploadWorkspaceFile } from "@/lib/storage";
import { assignableMembers, canEditTasks, canManageProject, projectViewerIds, visibleProjectWhere, visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { wouldCreateCycle } from "@/lib/tasks/dependencies";
import { parseTaskReference, taskReference, taskUrl } from "@/lib/tasks/links";
import { fromDateInputValue } from "@/lib/tasks/localDate";
import { extractMentionIds } from "@/lib/tasks/mentions";
import { placeAt, POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { sanitizeDescription } from "@/lib/tasks/sanitize";
import {
  addCommentSchema,
  addDependencySchema,
  archiveTaskSchema,
  commentIdSchema,
  completeTaskSchema,
  createTaskSchema,
  editCommentSchema,
  fileIdSchema,
  moveTaskSchema,
  removeDependencySchema,
  setAssigneesSchema,
  setLabelsSchema,
  taskIdSchema,
  updateTaskSchema,
} from "@/lib/tasks/schemas";
import { indexTask } from "@/lib/tasks/search";

/**
 * Task mutations. Each function takes an actor resolved server-side
 * (Server Actions use `getWorkspaceForAction`), re-checks capability and
 * visibility, validates with Zod, writes in a transaction together with
 * the task history (TaskActivity), the workspace activity feed, audit rows
 * and notifications (`dispatch` with `{ tx }`), then reindexes search and
 * publishes realtime nudges after commit.
 */

type Tx = Prisma.TransactionClient;
type After = Array<() => Promise<void>>;
type LoadedTask = Task & { project: Project | null };

const ARCHIVED_PROJECT = "This project is archived. Restore it to make changes.";
const ARCHIVED_TASK = "This task is archived. Restore it to make changes.";
const NOT_FOUND = "That task doesn't exist or you can't see it.";

export async function loadVisibleTask(actor: TaskActor, taskId: string, client: DbClient = prisma): Promise<LoadedTask | null> {
  return client.task.findFirst({ where: { AND: [await visibleTaskWhere(actor, client), { id: taskId }] }, include: { project: true } });
}

/** Load a task the actor may change (MEMBER+, visible, live project, not archived unless allowed). */
async function loadEditableTask(actor: TaskActor, taskId: string, options: { allowArchived?: boolean } = {}): Promise<{ task: LoadedTask } | { error: string }> {
  if (!canEditTasks(actor)) return { error: NOT_ALLOWED };
  const task = await loadVisibleTask(actor, taskId);
  if (!task) return { error: NOT_FOUND };
  if (task.project?.status === "ARCHIVED") return { error: ARCHIVED_PROJECT };
  if (task.archivedAt && !options.allowArchived) return { error: ARCHIVED_TASK };
  return { task };
}

const actorName = (actor: TaskActor) => actor.user.name ?? "Someone";

function eventBase(actor: TaskActor, task: Pick<Task, "id" | "number" | "projectId">, project: Pick<Project, "id" | "key"> | null) {
  return {
    url: taskUrl(actor.workspace.slug, project?.key, task.number),
    actorId: actor.user.id,
    resource: { type: "task", id: task.id },
    scope: { taskId: task.id, ...(project ? { projectId: project.id } : {}) },
    data: { taskId: task.id, taskNumber: task.number, projectId: task.projectId },
  };
}

async function notify<T extends keyof EventPayloads>(tx: Tx, after: After, workspaceId: string, event: NotificationEvent<T>) {
  const result = await dispatch(workspaceId, event, { tx });
  after.push(result.afterCommit);
}

async function runAfter(after: After) {
  for (const fn of after) await fn().catch(() => undefined);
}

async function addHistory(tx: Tx, taskId: string, actorId: string | null, kind: string, data?: Prisma.InputJsonValue) {
  await tx.taskActivity.create({ data: { taskId, actorId, kind, ...(data === undefined ? {} : { data }) } });
}

async function validateAssignees(actor: TaskActor, project: { teamId: string | null } | null, userIds: string[], client: DbClient) {
  if (userIds.length === 0) return { ok: true as const, userIds };
  const allowed = new Set((await assignableMembers(actor.workspace.id, project, client)).map((person) => person.id));
  if (!userIds.every((id) => allowed.has(id))) return { ok: false as const };
  return { ok: true as const, userIds };
}

async function validateLabels(actor: TaskActor, labelIds: string[], client: DbClient) {
  if (labelIds.length === 0) return { ok: true as const, labels: [] as Array<{ id: string; name: string }> };
  const labels = await client.label.findMany({ where: { workspaceId: actor.workspace.id, id: { in: labelIds } }, select: { id: true, name: true } });
  return labels.length === labelIds.length ? { ok: true as const, labels } : { ok: false as const };
}

/** Recipients who can still see the task (creator may have left a private team). */
async function visibleRecipients(tx: Tx, workspaceId: string, project: { teamId: string | null } | null, userIds: Array<string | null | undefined>) {
  const viewers = await projectViewerIds(workspaceId, project, tx);
  return [...new Set(userIds.filter((id): id is string => Boolean(id) && viewers.has(id as string)))];
}

/* ---------- Create ---------- */

export async function createTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string; number: number; url: string; reference: string }>> {
  if (!canEditTasks(actor)) return actionError(NOT_ALLOWED);
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;

  let project: Project | null = null;
  let parent: LoadedTask | null = null;
  let columnId: string | null = null;
  let columnCategory: string | null = null;
  if (data.parentId) {
    parent = await loadVisibleTask(actor, data.parentId);
    if (!parent) return actionError(NOT_FOUND);
    if (parent.parentId) return actionError("Subtasks can't have their own subtasks.");
    if (parent.archivedAt) return actionError(ARCHIVED_TASK);
    project = parent.project;
  } else if (data.projectId) {
    project = await prisma.project.findFirst({ where: { AND: [{ id: data.projectId }, await visibleProjectWhere(actor)] } });
    if (!project) return actionError(NOT_ALLOWED);
    const column = data.columnId
      ? await prisma.boardColumn.findFirst({ where: { id: data.columnId, projectId: project.id } })
      : await prisma.boardColumn.findFirst({ where: { projectId: project.id }, orderBy: { position: "asc" } });
    if (data.columnId && !column) return actionError("That column isn't on this board any more. Reload and try again.");
    columnId = column?.id ?? null;
    columnCategory = column?.category ?? null;
  }
  if (project?.status === "ARCHIVED") return actionError(ARCHIVED_PROJECT);

  const assignees = await validateAssignees(actor, project, data.assigneeIds, prisma);
  if (!assignees.ok) return actionError("Assign only members who can see this project.", { assigneeIds: ["Choose members of this project."] });
  const labels = await validateLabels(actor, data.labelIds, prisma);
  if (!labels.ok) return actionError("One of those labels no longer exists. Reload and try again.");
  const dueAt = data.dueDate ? fromDateInputValue(data.dueDate, actor.workspace.timezone) : null;
  if (data.dueDate && !dueAt) return actionError("Pick a valid date.", { dueDate: ["Pick a valid date."] });
  const description = sanitizeDescription(data.description);
  const after: After = [];

  const task = await prisma.$transaction(async (tx) => {
    const number = await nextWorkspaceSequence(tx, actor.workspace.id, "task");
    let position = POSITION_GAP;
    if (columnId) {
      const edge = await tx.task.aggregate({ where: { columnId, parentId: null, archivedAt: null }, _max: { position: true }, _min: { position: true } });
      position = data.atTop ? (edge._min.position ?? POSITION_GAP * 2) - POSITION_GAP : (edge._max.position ?? 0) + POSITION_GAP;
    } else if (parent) {
      const edge = await tx.task.aggregate({ where: { parentId: parent.id }, _max: { position: true } });
      position = (edge._max.position ?? 0) + POSITION_GAP;
    }
    const task = await tx.task.create({
      data: {
        workspaceId: actor.workspace.id,
        projectId: project?.id ?? null,
        columnId,
        parentId: parent?.id ?? null,
        number,
        title: data.title,
        description,
        priority: data.priority,
        dueAt,
        position,
        creatorId: actor.user.id,
        completedAt: columnCategory === "DONE" ? new Date() : null,
        assignees: { create: assignees.userIds.map((userId) => ({ userId })) },
        labels: { create: data.labelIds.map((labelId) => ({ labelId })) },
      },
    });
    await addHistory(tx, task.id, actor.user.id, "created");
    if (parent) await addHistory(tx, parent.id, actor.user.id, "subtask_added", { number: task.number, title: task.title.slice(0, 120) });
    await recordActivity(
      { workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "created", entityType: "task", entityId: task.id, summary: `created ${taskReference(project?.key, number)} ${task.title}`, projectId: project?.id ?? null, teamId: project?.teamId ?? null },
      tx,
    );
    await recordAuditEvent({ action: "task.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { number, projectId: project?.id ?? null }, client: tx });
    await indexTask(tx, actor.workspace.slug, task, project);
    const recipients = assignees.userIds.filter((id) => id !== actor.user.id);
    if (recipients.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...eventBase(actor, task, project),
        type: "task.assigned",
        title: `${actorName(actor)} assigned you ${taskReference(project?.key, number)}: ${task.title}`,
        recipients,
      });
    }
    return task;
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project, taskIds: parent ? [task.id, parent.id] : [task.id], type: "task.created", actorId: actor.user.id });
  return { ok: true, data: { id: task.id, number: task.number, url: taskUrl(actor.workspace.slug, project?.key, task.number), reference: taskReference(project?.key, task.number) } };
}

/* ---------- Edit fields ---------- */

export async function updateTask(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const data: Prisma.TaskUpdateInput = {};
  const history: Array<[string, Prisma.InputJsonValue]> = [];
  if (parsed.data.title !== undefined && parsed.data.title !== task.title) {
    data.title = parsed.data.title;
    history.push(["title", { from: task.title.slice(0, 120), to: parsed.data.title.slice(0, 120) }]);
  }
  if (parsed.data.description !== undefined) {
    const description = sanitizeDescription(parsed.data.description);
    if (description !== task.description) {
      data.description = description;
      history.push(["description", {}]);
    }
  }
  if (parsed.data.priority !== undefined && parsed.data.priority !== task.priority) {
    data.priority = parsed.data.priority;
    history.push(["priority", { from: task.priority, to: parsed.data.priority }]);
  }
  if (parsed.data.dueDate !== undefined) {
    const dueAt = parsed.data.dueDate ? fromDateInputValue(parsed.data.dueDate, actor.workspace.timezone) : null;
    if (parsed.data.dueDate && !dueAt) return actionError("Pick a valid date.", { dueDate: ["Pick a valid date."] });
    if (parsed.data.dueDate && task.startsOn && parsed.data.dueDate < task.startsOn.toISOString().slice(0, 10)) return actionError("Due date must be on or after the start date. Change the start date first.");
    if ((dueAt?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) {
      data.dueAt = dueAt;
      history.push(["due", { to: dueAt?.toISOString() ?? null }]);
    }
  }
  if (history.length === 0) return { ok: true };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: task.id }, data });
    for (const [kind, value] of history) await addHistory(tx, task.id, actor.user.id, kind, value);
    await indexTask(tx, actor.workspace.slug, updated, task.project);
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Completion side effects ---------- */

async function afterStatusChange(tx: Tx, after: After, actor: TaskActor, task: LoadedTask, change: { completed: boolean | null; fromColumn: { id: string; name: string } | null; toColumn: { id: string; name: string } | null }) {
  const ref = taskReference(task.project?.key, task.number);
  if (change.completed === true) {
    await addHistory(tx, task.id, actor.user.id, "completed");
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "completed", entityType: "task", entityId: task.id, summary: `completed ${ref} ${task.title}`, projectId: task.projectId, teamId: task.project?.teamId ?? null }, tx);
  } else if (change.completed === false) {
    await addHistory(tx, task.id, actor.user.id, "reopened");
  }

  const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
  const recipients = (await visibleRecipients(tx, actor.workspace.id, task.project, [...assigneeIds, task.creatorId])).filter((id) => id !== actor.user.id);
  const title =
    change.completed === true
      ? `${actorName(actor)} completed ${ref}: ${task.title}`
      : change.toColumn
        ? `${actorName(actor)} moved ${ref} to ${change.toColumn.name}: ${task.title}`
        : `${actorName(actor)} reopened ${ref}: ${task.title}`;
  const base = eventBase(actor, task, task.project);
  await notify(tx, after, actor.workspace.id, {
    ...base,
    type: "task.status_changed",
    title,
    recipients,
    data: { ...base.data, fromColumnId: change.fromColumn?.id ?? null, toColumnId: change.toColumn?.id ?? null },
  });

  if (change.completed !== true) return;

  // Unblock: tasks this one was blocking whose last open blocker just closed.
  const blocked = await tx.taskDependency.findMany({
    where: { workspaceId: actor.workspace.id, blockingTaskId: task.id, type: "BLOCKS", blockedTask: { workspaceId: actor.workspace.id, completedAt: null, archivedAt: null, blockerReason: null } },
    select: { blockedTask: { select: { id: true, number: true, title: true, projectId: true, project: true, assignees: { select: { userId: true } } } } },
  });
  for (const { blockedTask } of blocked) {
    const open = await tx.taskDependency.count({ where: { workspaceId: actor.workspace.id, blockedTaskId: blockedTask.id, type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } } });
    if (open > 0) continue;
    await addHistory(tx, blockedTask.id, actor.user.id, "unblocked", { by: ref });
    const ids = blockedTask.assignees.map((row) => row.userId);
    if (ids.length === 0) continue;
    const blockedBase = eventBase(actor, blockedTask, blockedTask.project);
    await notify(tx, after, actor.workspace.id, {
      ...blockedBase,
      type: "task.unblocked",
      title: `${taskReference(blockedTask.project?.key, blockedTask.number)} is ready to go: ${ref} is done`,
      recipients: ids,
      dedupeKey: `task.unblocked:${blockedTask.id}:${task.id}`,
      data: { ...blockedBase.data, blockerTaskId: task.id },
    });
  }

  // Repeat after completion: let the scheduler create the next instance.
  const rule = await tx.taskRecurrence.findFirst({
    where: { workspaceId: actor.workspace.id, active: true, createMode: "ON_COMPLETION", OR: [{ lastCreatedTaskId: task.id }, { templateTaskId: task.id, lastCreatedTaskId: null }] },
    select: { id: true },
  });
  if (rule) await tx.taskRecurrence.update({ where: { id: rule.id }, data: { nextRunAt: new Date() } });
}

/* ---------- Move on the board ---------- */

export async function moveTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ warning?: string }>> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  if (!task.projectId || task.parentId) return actionError("Only tasks on a board can be moved.");
  const [target, source] = await Promise.all([
    prisma.boardColumn.findFirst({ where: { id: parsed.data.columnId, projectId: task.projectId } }),
    task.columnId ? prisma.boardColumn.findUnique({ where: { id: task.columnId } }) : Promise.resolve(null),
  ]);
  if (!target) return actionError("That column isn't on this board any more. Reload and try again.");
  const after: After = [];
  let warning: string | undefined;

  await prisma.$transaction(async (tx) => {
    const siblings = await tx.task.findMany({
      where: { columnId: target.id, parentId: null, archivedAt: null, id: { not: task.id } },
      orderBy: [{ position: "asc" }, { number: "asc" }],
      select: { id: true, position: true },
    });
    const anchor = parsed.data.afterTaskId ? siblings.findIndex((row) => row.id === parsed.data.afterTaskId) : -1;
    const index = parsed.data.afterTaskId === null ? 0 : anchor === -1 ? siblings.length : anchor + 1;
    const placement = placeAt(siblings.map((row) => row.position), index);
    if (placement.rebalanced) {
      for (const [i, row] of siblings.entries()) await tx.task.update({ where: { id: row.id }, data: { position: placement.rebalanced[i]! } });
    }
    const wasDone = Boolean(task.completedAt);
    const nowDone = target.category === "DONE";
    const completedChange = nowDone && !wasDone ? true : !nowDone && wasDone ? false : null;
    await tx.task.update({
      where: { id: task.id },
      data: { columnId: target.id, position: placement.position, ...(completedChange === true ? { completedAt: new Date() } : completedChange === false ? { completedAt: null } : {}) },
    });
    if (source?.id !== target.id) {
      await addHistory(tx, task.id, actor.user.id, "moved", { from: source?.name ?? null, to: target.name });
      await afterStatusChange(tx, after, actor, task, { completed: completedChange, fromColumn: source ? { id: source.id, name: source.name } : null, toColumn: { id: target.id, name: target.name } });
    }
    if (completedChange === true) {
      const open = await tx.taskDependency.count({ where: { blockedTaskId: task.id, type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } } });
      if (open > 0) warning = `Moved, but ${taskReference(task.project?.key, task.number)} is still blocked by ${open === 1 ? "another task" : `${open} tasks`}.`;
    }
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true, data: warning ? { warning } : {} };
}

/* ---------- Complete / reopen (checkbox, My tasks, subtasks) ---------- */

export async function setTaskCompleted(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = completeTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const completed = parsed.data.completed;
  if (Boolean(task.completedAt) === completed) return { ok: true };
  const after: After = [];

  await prisma.$transaction(async (tx) => {
    let toColumn: { id: string; name: string; category: string } | null = null;
    const fromColumn = task.columnId ? await tx.boardColumn.findUnique({ where: { id: task.columnId }, select: { id: true, name: true, category: true } }) : null;
    if (task.projectId && !task.parentId) {
      const columns = await tx.boardColumn.findMany({ where: { projectId: task.projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } });
      if (completed && fromColumn?.category !== "DONE") toColumn = columns.find((column) => column.category === "DONE") ?? null;
      if (!completed && fromColumn?.category === "DONE") toColumn = columns.find((column) => column.category === "TODO") ?? columns.find((column) => column.category !== "DONE") ?? null;
    }
    let position = task.position;
    if (toColumn) {
      const edge = await tx.task.aggregate({ where: { columnId: toColumn.id, parentId: null, archivedAt: null }, _min: { position: true }, _max: { position: true } });
      position = completed ? (edge._min.position ?? POSITION_GAP * 2) - POSITION_GAP : (edge._max.position ?? 0) + POSITION_GAP;
    }
    await tx.task.update({ where: { id: task.id }, data: { completedAt: completed ? new Date() : null, ...(toColumn ? { columnId: toColumn.id, position } : {}) } });
    if (toColumn) await addHistory(tx, task.id, actor.user.id, "moved", { from: fromColumn?.name ?? null, to: toColumn.name });
    await afterStatusChange(tx, after, actor, task, { completed, fromColumn: toColumn ? fromColumn : null, toColumn });
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Assignees and labels ---------- */

export async function setAssignees(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = setAssigneesSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const checked = await validateAssignees(actor, task.project, parsed.data.userIds, prisma);
  if (!checked.ok) return actionError("Assign only members who can see this project.");
  const current = (await prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
  const added = checked.userIds.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !checked.userIds.includes(id));
  if (added.length === 0 && removed.length === 0) return { ok: true };
  const after: After = [];
  await prisma.$transaction(async (tx) => {
    if (removed.length) await tx.taskAssignee.deleteMany({ where: { taskId: task.id, userId: { in: removed } } });
    if (added.length) await tx.taskAssignee.createMany({ data: added.map((userId) => ({ taskId: task.id, userId })), skipDuplicates: true });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    if (added.length) await addHistory(tx, task.id, actor.user.id, "assigned", { userIds: added });
    if (removed.length) await addHistory(tx, task.id, actor.user.id, "unassigned", { userIds: removed });
    const recipients = added.filter((id) => id !== actor.user.id);
    if (recipients.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...eventBase(actor, task, task.project),
        type: "task.assigned",
        title: `${actorName(actor)} assigned you ${taskReference(task.project?.key, task.number)}: ${task.title}`,
        recipients,
      });
    }
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function setLabels(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = setLabelsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const checked = await validateLabels(actor, parsed.data.labelIds, prisma);
  if (!checked.ok) return actionError("One of those labels no longer exists. Reload and try again.");
  const current = (await prisma.taskLabel.findMany({ where: { taskId: task.id }, select: { labelId: true, label: { select: { name: true } } } }));
  const currentIds = current.map((row) => row.labelId);
  const added = checked.labels.filter((label) => !currentIds.includes(label.id));
  const removed = current.filter((row) => !parsed.data.labelIds.includes(row.labelId));
  if (added.length === 0 && removed.length === 0) return { ok: true };
  await prisma.$transaction(async (tx) => {
    if (removed.length) await tx.taskLabel.deleteMany({ where: { taskId: task.id, labelId: { in: removed.map((row) => row.labelId) } } });
    if (added.length) await tx.taskLabel.createMany({ data: added.map((label) => ({ taskId: task.id, labelId: label.id })), skipDuplicates: true });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    if (added.length) await addHistory(tx, task.id, actor.user.id, "labeled", { names: added.map((label) => label.name) });
    if (removed.length) await addHistory(tx, task.id, actor.user.id, "unlabeled", { names: removed.map((row) => row.label.name) });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Archive / restore ---------- */

export async function setTaskArchived(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = archiveTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { allowArchived: true });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const archived = parsed.data.archived;
  if (Boolean(task.archivedAt) === archived) return { ok: true };
  await prisma.$transaction(async (tx) => {
    let position = task.position;
    if (!archived && task.columnId) {
      const edge = await tx.task.aggregate({ where: { columnId: task.columnId, parentId: null, archivedAt: null }, _max: { position: true } });
      position = (edge._max.position ?? 0) + POSITION_GAP;
    }
    const updated = await tx.task.update({ where: { id: task.id }, data: { archivedAt: archived ? new Date() : null, position } });
    await addHistory(tx, task.id, actor.user.id, archived ? "archived" : "restored");
    await recordAuditEvent({ action: archived ? "task.archived" : "task.restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { number: task.number }, client: tx });
    await indexTask(tx, actor.workspace.slug, updated, task.project);
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: archived ? "task.removed" : "task.created", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Comments and mentions ---------- */

async function commentTarget(actor: TaskActor, taskId: string) {
  const task = await loadVisibleTask(actor, taskId);
  if (!task) return { error: NOT_FOUND } as const;
  if (task.archivedAt) return { error: ARCHIVED_TASK } as const;
  return { task } as const;
}

/** Keep only mentions of people who can see the task; unknown tokens are left as text. */
async function mentionRecipients(tx: Tx, actor: TaskActor, task: LoadedTask, body: string) {
  const ids = extractMentionIds(body);
  if (ids.length === 0) return [];
  return visibleRecipients(tx, actor.workspace.id, task.project, ids);
}

export async function addComment(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await commentTarget(actor, parsed.data.taskId);
  if (found.error) return actionError(found.error);
  const { task } = found;
  const after: After = [];
  const ref = taskReference(task.project?.key, task.number);
  const comment = await prisma.$transaction(async (tx) => {
    const comment = await tx.taskComment.create({ data: { taskId: task.id, authorId: actor.user.id, body: parsed.data.body } });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    await addHistory(tx, task.id, actor.user.id, "commented");
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "commented", entityType: "task", entityId: task.id, summary: `commented on ${ref} ${task.title}`, projectId: task.projectId, teamId: task.project?.teamId ?? null }, tx);
    const base = eventBase(actor, task, task.project);
    const mentioned = (await mentionRecipients(tx, actor, task, parsed.data.body)).filter((id) => id !== actor.user.id);
    if (mentioned.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...base,
        type: "mention",
        title: `${actorName(actor)} mentioned you on ${ref}: ${task.title}`,
        recipients: mentioned,
        data: { sourceType: "task_comment", sourceId: comment.id, channelId: null },
      });
    }
    const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
    const watchers = (await visibleRecipients(tx, actor.workspace.id, task.project, [...assigneeIds, task.creatorId])).filter((id) => id !== actor.user.id && !mentioned.includes(id));
    if (watchers.length > 0) {
      await notify(tx, after, actor.workspace.id, {
        ...base,
        type: "task.commented",
        title: `${actorName(actor)} commented on ${ref}: ${task.title}`,
        recipients: watchers,
        data: { ...base.data, commentId: comment.id },
      });
    }
    return comment;
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "comment.changed", actorId: actor.user.id });
  return { ok: true, data: { id: comment.id } };
}

async function ownComment(actor: TaskActor, commentId: string, options: { adminMayAct: boolean }) {
  const comment = await prisma.taskComment.findFirst({ where: { id: commentId, deletedAt: null, task: { workspaceId: actor.workspace.id } } });
  if (!comment) return { error: "That comment doesn't exist any more." } as const;
  const task = await loadVisibleTask(actor, comment.taskId);
  if (!task) return { error: NOT_FOUND } as const;
  const isAuthor = comment.authorId === actor.user.id;
  if (!isAuthor && !(options.adminMayAct && hasRoleAtLeast(actor.membership.role, "ADMIN"))) return { error: NOT_ALLOWED } as const;
  return { comment, task } as const;
}

export async function editComment(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = editCommentSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await ownComment(actor, parsed.data.commentId, { adminMayAct: false });
  if (found.error) return actionError(found.error);
  const { comment, task } = found;
  if (comment.body === parsed.data.body) return { ok: true };
  const after: After = [];
  await prisma.$transaction(async (tx) => {
    await tx.taskComment.update({ where: { id: comment.id }, data: { body: parsed.data.body, editedAt: new Date() } });
    const before = new Set(extractMentionIds(comment.body));
    const fresh = (await mentionRecipients(tx, actor, task, parsed.data.body)).filter((id) => !before.has(id) && id !== actor.user.id);
    if (fresh.length > 0) {
      const ref = taskReference(task.project?.key, task.number);
      await notify(tx, after, actor.workspace.id, {
        ...eventBase(actor, task, task.project),
        type: "mention",
        title: `${actorName(actor)} mentioned you on ${ref}: ${task.title}`,
        recipients: fresh,
        data: { sourceType: "task_comment", sourceId: comment.id, channelId: null },
      });
    }
  });
  await runAfter(after);
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "comment.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function deleteComment(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = commentIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await ownComment(actor, parsed.data.commentId, { adminMayAct: true });
  if (found.error) return actionError(found.error);
  const { comment, task } = found;
  await prisma.$transaction(async (tx) => {
    await tx.taskComment.update({ where: { id: comment.id }, data: { deletedAt: new Date(), body: "" } });
    await recordAuditEvent({ action: "task.comment_deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "TaskComment", targetId: comment.id, metadata: { taskId: task.id, byAuthor: comment.authorId === actor.user.id }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "comment.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Dependencies ---------- */

export async function addDependency(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = addDependencySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const reference = parseTaskReference(parsed.data.reference);
  if (!reference) return actionError("Enter a task reference like BOT-12.", { reference: ["Use a reference like BOT-12."] });
  const other = await prisma.task.findFirst({
    where: { AND: [await visibleTaskWhere(actor), { number: reference.number }] },
    include: { project: true },
  });
  if (!other || (reference.key && other.project?.key !== reference.key)) return actionError(`Couldn't find ${parsed.data.reference.toUpperCase()}. Check the reference.`, { reference: ["No task with that reference."] });
  if (other.id === task.id) return actionError("A task can't depend on itself.");
  const blockingTaskId = parsed.data.direction === "blockedBy" ? other.id : task.id;
  const blockedTaskId = parsed.data.direction === "blockedBy" ? task.id : other.id;

  const result = await prisma.$transaction(async (tx) => {
    // Serialise dependency writes per workspace so two opposite edges can't both pass the cycle check.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-deps:${actor.workspace.id}`}))`;
    const existing = await tx.taskDependency.findUnique({ where: { blockingTaskId_blockedTaskId: { blockingTaskId, blockedTaskId } } });
    if (existing) return "exists" as const;
    const edges = await tx.taskDependency.findMany({ where: { workspaceId: actor.workspace.id, type: "BLOCKS" }, select: { blockingTaskId: true, blockedTaskId: true } });
    if (wouldCreateCycle(edges, blockingTaskId, blockedTaskId)) return "cycle" as const;
    await tx.taskDependency.create({ data: { workspaceId: actor.workspace.id, blockingTaskId, blockedTaskId, type: "BLOCKS", createdById: actor.user.id } });
    const blockingRef = blockingTaskId === task.id ? taskReference(task.project?.key, task.number) : taskReference(other.project?.key, other.number);
    const blockedRef = blockedTaskId === task.id ? taskReference(task.project?.key, task.number) : taskReference(other.project?.key, other.number);
    await addHistory(tx, blockedTaskId, actor.user.id, "blocked_by_added", { ref: blockingRef });
    await addHistory(tx, blockingTaskId, actor.user.id, "blocks_added", { ref: blockedRef });
    await recordAuditEvent({ action: "task.dependency_added", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: blockedTaskId, metadata: { blockingTaskId }, client: tx });
    return "ok" as const;
  });
  if (result === "exists") return actionError("Those tasks are already linked.");
  if (result === "cycle") return actionError("That would make the tasks wait on each other in a circle: the other task already waits on this one.");
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id, other.id], type: "task.changed", actorId: actor.user.id });
  if (other.projectId && other.projectId !== task.projectId) await publishTaskChange({ workspaceId: actor.workspace.id, project: other.project, taskIds: [], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function removeDependency(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = removeDependencySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.blockedTaskId);
  if ("error" in found) return actionError(found.error);
  const edge = await prisma.taskDependency.findFirst({ where: { workspaceId: actor.workspace.id, blockingTaskId: parsed.data.blockingTaskId, blockedTaskId: parsed.data.blockedTaskId } });
  if (!edge) return { ok: true };
  const blocking = await loadVisibleTask(actor, edge.blockingTaskId);
  await prisma.$transaction(async (tx) => {
    await tx.taskDependency.delete({ where: { blockingTaskId_blockedTaskId: { blockingTaskId: edge.blockingTaskId, blockedTaskId: edge.blockedTaskId } } });
    await addHistory(tx, edge.blockedTaskId, actor.user.id, "blocked_by_removed", { ref: blocking ? taskReference(blocking.project?.key, blocking.number) : null });
    await recordAuditEvent({ action: "task.dependency_removed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: edge.blockedTaskId, metadata: { blockingTaskId: edge.blockingTaskId }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: found.task.project, taskIds: [edge.blockedTaskId, edge.blockingTaskId], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

/* ---------- Attachments ---------- */

export async function addAttachment(actor: TaskActor, taskId: string, file: File): Promise<ActionResult<{ id: string }>> {
  const parsedId = taskIdSchema.safeParse({ taskId });
  if (!parsedId.success) return validationError(parsedId.error);
  const found = await loadEditableTask(actor, parsedId.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const count = await prisma.fileObject.count({ where: { taskId: task.id, deletedAt: null } });
  if (count >= 50) return actionError("A task can hold up to 50 attachments.");
  const uploaded = await uploadWorkspaceFile({ workspaceId: actor.workspace.id, uploadedById: actor.user.id, file, folder: "/tasks", taskId: task.id });
  if (!uploaded.ok) return actionError(uploaded.error);
  await prisma.$transaction(async (tx) => {
    await addHistory(tx, task.id, actor.user.id, "attachment_added", { filename: uploaded.file.filename.slice(0, 120) });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true, data: { id: uploaded.file.id } };
}

export async function removeAttachment(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = fileIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId);
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const file = await prisma.fileObject.findFirst({ where: { id: parsed.data.fileId, taskId: task.id, workspaceId: actor.workspace.id, deletedAt: null } });
  if (!file) return { ok: true };
  const mayDelete = file.uploadedById === actor.user.id || (task.project ? canManageProject(actor, task.project) : hasRoleAtLeast(actor.membership.role, "ADMIN"));
  if (!mayDelete) return actionError("Only the person who added a file, or an admin, can remove it.");
  await prisma.$transaction(async (tx) => {
    await tx.fileObject.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    await addHistory(tx, task.id, actor.user.id, "attachment_removed", { filename: file.filename.slice(0, 120) });
    await recordAuditEvent({ action: "task.attachment_removed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { fileId: file.id }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

