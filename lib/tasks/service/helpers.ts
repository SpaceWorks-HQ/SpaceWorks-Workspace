import "server-only";
import type { Prisma, Project, Task } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { NOT_ALLOWED } from "@/lib/actionResult";
import { dispatch } from "@/lib/notify";
import type { EventPayloads, NotificationEvent } from "@/lib/notify";
import {
  assignableMembers,
  canEditTasks,
  projectViewerIds,
  visibleTaskWhere,
  type TaskActor,
} from "@/lib/tasks/access";
import { taskUrl } from "@/lib/tasks/links";

export type Tx = Prisma.TransactionClient;
export type After = Array<() => Promise<void>>;
export type LoadedTask = Task & { project: Project | null };

export const ARCHIVED_PROJECT = "This project is archived. Restore it to make changes.";
export const ARCHIVED_TASK = "This task is archived. Restore it to make changes.";
export const NOT_FOUND = "That task doesn't exist or you can't see it.";

export async function loadVisibleTask(actor: TaskActor, taskId: string, client: DbClient = prisma): Promise<LoadedTask | null> {
  return client.task.findFirst({ where: { AND: [await visibleTaskWhere(actor, client), { id: taskId }] }, include: { project: true } });
}

/** Load a task the actor may change (MEMBER+, visible, live project, not archived unless allowed). */
export async function loadEditableTask(actor: TaskActor, taskId: string, options: { allowArchived?: boolean } = {}): Promise<{ task: LoadedTask } | { error: string }> {
  if (!canEditTasks(actor)) return { error: NOT_ALLOWED };
  const task = await loadVisibleTask(actor, taskId);
  if (!task) return { error: NOT_FOUND };
  if (task.project?.status === "ARCHIVED") return { error: ARCHIVED_PROJECT };
  if (task.archivedAt && !options.allowArchived) return { error: ARCHIVED_TASK };
  return { task };
}

export const actorName = (actor: TaskActor) => actor.user.name ?? "Someone";

export function eventBase(actor: TaskActor, task: Pick<Task, "id" | "number" | "projectId">, project: Pick<Project, "id" | "key"> | null) {
  return {
    url: taskUrl(actor.workspace.slug, project?.key, task.number),
    actorId: actor.user.id,
    resource: { type: "task", id: task.id },
    scope: { taskId: task.id, ...(project ? { projectId: project.id } : {}) },
    data: { taskId: task.id, taskNumber: task.number, projectId: task.projectId },
  };
}

export async function notify<T extends keyof EventPayloads>(tx: Tx, after: After, workspaceId: string, event: NotificationEvent<T>) {
  const result = await dispatch(workspaceId, event, { tx });
  after.push(result.afterCommit);
}

export async function runAfter(after: After) {
  for (const fn of after) await fn().catch(() => undefined);
}

export async function addHistory(tx: Tx, taskId: string, actorId: string | null, kind: string, data?: Prisma.InputJsonValue) {
  await tx.taskActivity.create({ data: { taskId, actorId, kind, ...(data === undefined ? {} : { data }) } });
}

export async function validateAssignees(actor: TaskActor, project: { teamId: string | null } | null, userIds: string[], client: DbClient) {
  if (userIds.length === 0) return { ok: true as const, userIds };
  const allowed = new Set((await assignableMembers(actor.workspace.id, project, client)).map((person) => person.id));
  if (!userIds.every((id) => allowed.has(id))) return { ok: false as const };
  return { ok: true as const, userIds };
}

export async function validateLabels(actor: TaskActor, labelIds: string[], client: DbClient) {
  if (labelIds.length === 0) return { ok: true as const, labels: [] as Array<{ id: string; name: string }> };
  const labels = await client.label.findMany({ where: { workspaceId: actor.workspace.id, id: { in: labelIds } }, select: { id: true, name: true } });
  return labels.length === labelIds.length ? { ok: true as const, labels } : { ok: false as const };
}

/** Recipients who can still see the task (creator may have left a private team). */
export async function visibleRecipients(tx: Tx, workspaceId: string, project: { teamId: string | null } | null, userIds: Array<string | null | undefined>) {
  const viewers = await projectViewerIds(workspaceId, project, tx);
  return [...new Set(userIds.filter((id): id is string => Boolean(id) && viewers.has(id as string)))];
}
