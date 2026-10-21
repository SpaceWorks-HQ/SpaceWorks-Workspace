import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { type TaskActor } from "@/lib/tasks/access";
import { taskReference } from "@/lib/tasks/links";
import { POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { archiveTaskSchema, setAssigneesSchema, setLabelsSchema } from "@/lib/tasks/schemas";
import { indexTask } from "@/lib/tasks/search";
import {
  type After,
  loadEditableTask,
  actorName,
  eventBase,
  notify,
  runAfter,
  addHistory,
  validateAssignees,
  validateLabels,
} from "./helpers";

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
