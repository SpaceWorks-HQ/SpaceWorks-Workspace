import "server-only";

import type { Prisma, Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fileUrl } from "@/lib/storage";
import { hasRoleAtLeast } from "@/lib/roles";
import { assignableMembers, canEditTasks, canManageProject, visibleProjectWhere, visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { activityText, HIDDEN_ACTIVITY_KINDS } from "@/lib/tasks/activityText";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { describeRule, parseAssigneeRule, parseRRule } from "@/lib/tasks/recurrence";
import type { BoardData, BoardTask, ColumnDTO, LabelRef, MyTaskDTO, PersonRef, ProjectPermissions, ProjectSummary, TaskDetailDTO, TaskRef } from "@/lib/tasks/types";

/** Read models for the board, list, task detail and My tasks. Always tenant- and visibility-filtered. */

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const dateOnly = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);

export function permissionsFor(actor: TaskActor, project: Pick<Project, "ownerId" | "status"> | null): ProjectPermissions {
  const archived = project?.status === "ARCHIVED";
  return {
    canEdit: canEditTasks(actor) && !archived,
    canComment: true,
    canManage: project ? canManageProject(actor, project) : hasRoleAtLeast(actor.membership.role, "ADMIN"),
  };
}

export async function projectSummary(project: Project): Promise<ProjectSummary> {
  const team = project.teamId ? await prisma.team.findUnique({ where: { id: project.teamId }, select: { name: true } }) : null;
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    status: project.status,
    ownerId: project.ownerId,
    teamId: project.teamId,
    teamName: team?.name ?? null,
    startsOn: dateOnly(project.startsOn),
    dueOn: dateOnly(project.dueOn),
  };
}

export async function workspaceLabels(workspaceId: string): Promise<LabelRef[]> {
  return prisma.label.findMany({ where: { workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, tone: true } });
}

const boardTaskSelect = {
  id: true,
  number: true,
  title: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  columnId: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  recurrenceId: true,
  assignees: { select: { userId: true }, orderBy: { assignedAt: "asc" } },
  labels: { select: { labelId: true } },
  blockedBy: { where: { type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } }, select: { blockingTaskId: true } },
  _count: {
    select: {
      subtasks: { where: { archivedAt: null } },
      comments: { where: { deletedAt: null } },
      files: { where: { deletedAt: null } },
      recurrenceRules: { where: { active: true } },
    },
  },
} satisfies Prisma.TaskSelect;

type BoardTaskRow = Prisma.TaskGetPayload<{ select: typeof boardTaskSelect }>;

async function toBoardTasks(rows: BoardTaskRow[]): Promise<BoardTask[]> {
  const done = rows.length
    ? await prisma.task.groupBy({ by: ["parentId"], where: { parentId: { in: rows.map((row) => row.id) }, archivedAt: null, completedAt: { not: null } }, _count: { _all: true } })
    : [];
  const doneBy = new Map(done.map((row) => [row.parentId, row._count._all]));
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    priority: row.priority,
    dueAt: iso(row.dueAt),
    completedAt: iso(row.completedAt),
    columnId: row.columnId,
    position: row.position,
    assigneeIds: row.assignees.map((a) => a.userId),
    labelIds: row.labels.map((l) => l.labelId),
    subtaskCount: row._count.subtasks,
    subtaskDone: doneBy.get(row.id) ?? 0,
    commentCount: row._count.comments,
    attachmentCount: row._count.files,
    blocked: row.blockedBy.length > 0,
    recurring: Boolean(row.recurrenceId) || row._count.recurrenceRules > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function findProjectByKey(actor: TaskActor, key: string) {
  if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(key)) return null;
  return prisma.project.findFirst({ where: { AND: [await visibleProjectWhere(actor), { key: key.toUpperCase() }] } });
}

export async function getBoardData(actor: TaskActor, key: string): Promise<BoardData | null> {
  const project = await findProjectByKey(actor, key);
  if (!project) return null;
  const [summary, columns, rows, members, labels] = await Promise.all([
    projectSummary(project),
    prisma.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, category: true } }),
    prisma.task.findMany({ where: { projectId: project.id, parentId: null, archivedAt: null }, orderBy: [{ position: "asc" }, { number: "asc" }], select: boardTaskSelect, take: 2000 }),
    assignableMembers(actor.workspace.id, project),
    workspaceLabels(actor.workspace.id),
  ]);
  return { project: summary, columns, tasks: await toBoardTasks(rows), members, labels, permissions: permissionsFor(actor, project) };
}

/** Archived tasks of a project, newest first (for the "Archived" view). */
export async function listArchivedTasks(actor: TaskActor, projectId: string) {
  return prisma.task.findMany({
    where: { AND: [await visibleTaskWhere(actor), { projectId, archivedAt: { not: null }, parentId: null }] },
    orderBy: { archivedAt: "desc" },
    take: 100,
    select: { id: true, number: true, title: true, archivedAt: true },
  });
}

async function people(ids: Iterable<string>): Promise<Map<string, PersonRef>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, image: true } });
  return new Map(users.map((user) => [user.id, user]));
}

function ref(task: { id: string; number: number; title: string; completedAt: Date | null; archivedAt: Date | null; project: { key: string } | null }): TaskRef {
  return { id: task.id, number: task.number, title: task.title, projectKey: task.project?.key ?? null, completedAt: iso(task.completedAt), archivedAt: iso(task.archivedAt) };
}

const refSelect = { id: true, number: true, title: true, completedAt: true, archivedAt: true, project: { select: { key: true } } } satisfies Prisma.TaskSelect;

export async function findVisibleTaskByNumber(actor: TaskActor, number: number) {
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return prisma.task.findFirst({ where: { AND: [await visibleTaskWhere(actor), { number }] }, include: { project: true } });
}

export async function getTaskDetail(actor: TaskActor, number: number): Promise<TaskDetailDTO | null> {
  const visible = await visibleTaskWhere(actor);
  const task = await prisma.task.findFirst({
    where: { AND: [visible, { number }] },
    include: {
      project: true,
      parent: { select: refSelect },
      assignees: { select: { user: { select: { id: true, name: true, image: true } } }, orderBy: { assignedAt: "asc" } },
      labels: { select: { labelId: true } },
      subtasks: { where: { archivedAt: null }, orderBy: [{ position: "asc" }, { number: "asc" }], select: { ...refSelect, assignees: { select: { user: { select: { id: true, name: true, image: true } } } } } },
      blockedBy: { where: { type: "BLOCKS" }, select: { blockingTask: { select: refSelect } } },
      blocking: { where: { type: "BLOCKS" }, select: { blockedTask: { select: refSelect } } },
      comments: { orderBy: { createdAt: "asc" }, take: 300, select: { id: true, authorId: true, body: true, createdAt: true, editedAt: true, deletedAt: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, actorId: true, kind: true, data: true, createdAt: true } },
      files: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, filename: true, size: true, contentType: true, uploadedById: true, createdAt: true } },
      recurrenceRules: { orderBy: [{ active: "desc" }, { updatedAt: "desc" }], take: 1 },
      recurrence: true,
    },
  });
  if (!task) return null;
  const project = task.project;
  const linkedIds = [...task.blockedBy.map((row) => row.blockingTask.id), ...task.blocking.map((row) => row.blockedTask.id)];
  const visibleLinked = linkedIds.length
    ? new Set((await prisma.task.findMany({ where: { AND: [visible, { id: { in: linkedIds } }] }, select: { id: true } })).map((row) => row.id))
    : new Set<string>();
  const rule = task.recurrenceRules[0] ?? task.recurrence ?? null;
  const personIds = [
    task.creatorId ?? "",
    ...task.comments.map((comment) => comment.authorId ?? ""),
    ...task.activities.map((activity) => activity.actorId ?? ""),
    ...task.files.map((file) => file.uploadedById ?? ""),
    ...task.activities.flatMap((activity) => {
      const data = activity.data as { userIds?: unknown } | null;
      return Array.isArray(data?.userIds) ? (data!.userIds as string[]) : [];
    }),
    ...task.comments.flatMap((comment) => [...comment.body.matchAll(/<@([A-Za-z0-9_-]{1,64})>/g)].map((match) => match[1]!)),
    ...(rule ? parseAssigneeRule(rule.assigneeRule).userIds : []),
  ];
  const [peopleMap, columns, members, labels, summary] = await Promise.all([
    people(personIds),
    project ? prisma.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, name: true, position: true, category: true } }) : Promise.resolve([] as ColumnDTO[]),
    assignableMembers(actor.workspace.id, project),
    workspaceLabels(actor.workspace.id),
    project ? projectSummary(project) : Promise.resolve(null),
  ]);
  const nameOf = (id: string) => peopleMap.get(id)?.name ?? members.find((member) => member.id === id)?.name ?? "a former member";
  const isAdmin = hasRoleAtLeast(actor.membership.role, "ADMIN");
  const permissions = permissionsFor(actor, project);
  const pattern = rule ? parseRRule(rule.rrule) : null;
  const assigneeRule = rule ? parseAssigneeRule(rule.assigneeRule) : null;

  return {
    id: task.id,
    number: task.number,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueAt: iso(task.dueAt),
    completedAt: iso(task.completedAt),
    archivedAt: iso(task.archivedAt),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    creator: task.creatorId ? (peopleMap.get(task.creatorId) ?? null) : null,
    columnId: task.columnId,
    project: summary,
    columns,
    parent: task.parent ? ref(task.parent) : null,
    assignees: task.assignees.map((row) => row.user),
    labelIds: task.labels.map((row) => row.labelId),
    subtasks: task.subtasks.map((subtask) => ({ ...ref(subtask), assignees: subtask.assignees.map((row) => row.user) })),
    blockedBy: task.blockedBy.filter((row) => visibleLinked.has(row.blockingTask.id)).map((row) => ref(row.blockingTask)),
    blocks: task.blocking.filter((row) => visibleLinked.has(row.blockedTask.id)).map((row) => ref(row.blockedTask)),
    comments: task.comments.map((comment) => ({
      id: comment.id,
      author: comment.authorId ? (peopleMap.get(comment.authorId) ?? null) : null,
      body: comment.deletedAt ? "" : comment.body,
      createdAt: comment.createdAt.toISOString(),
      editedAt: iso(comment.editedAt),
      deleted: Boolean(comment.deletedAt),
      canEdit: !comment.deletedAt && (comment.authorId === actor.user.id || isAdmin),
    })),
    activity: task.activities
      .filter((activity) => !HIDDEN_ACTIVITY_KINDS.has(activity.kind))
      .map((activity) => ({
        id: activity.id,
        actor: activity.actorId ? (peopleMap.get(activity.actorId) ?? null) : null,
        kind: activity.kind,
        text: activityText(activity.kind, activity.data as Record<string, unknown> | null, { nameOf, timeZone: actor.workspace.timezone }),
        createdAt: activity.createdAt.toISOString(),
      })),
    attachments: task.files.map((file) => ({
      id: file.id,
      filename: file.filename,
      size: file.size,
      contentType: file.contentType,
      url: fileUrl(file.id),
      uploadedBy: file.uploadedById ? (peopleMap.get(file.uploadedById) ?? null) : null,
      createdAt: file.createdAt.toISOString(),
      canDelete: permissions.canEdit && (file.uploadedById === actor.user.id || permissions.canManage),
    })),
    recurrence:
      rule && pattern && assigneeRule
        ? {
            id: rule.id,
            rrule: rule.rrule,
            description: describeRule(pattern),
            createMode: rule.createMode,
            assigneeMode: assigneeRule.type,
            assigneeIds: assigneeRule.userIds,
            dueOffsetDays: rule.dueOffsetDays,
            nextRunAt: iso(rule.nextRunAt),
            active: rule.active,
            isTemplate: rule.templateTaskId === task.id,
          }
        : null,
    members,
    labels,
    permissions,
    url: taskUrl(actor.workspace.slug, project?.key, task.number),
    reference: taskReference(project?.key, task.number),
    timeZone: actor.workspace.timezone,
    viewerId: actor.user.id,
  };
}

/** Open tasks assigned to the actor, plus those finished in the last 12 hours (so a quick complete can be undone). */
export async function listMyTasks(actor: TaskActor, now: Date = new Date()): Promise<MyTaskDTO[]> {
  const rows = await prisma.task.findMany({
    where: {
      AND: [
        await visibleTaskWhere(actor),
        { archivedAt: null, assignees: { some: { userId: actor.user.id } } },
        { OR: [{ completedAt: null }, { completedAt: { gte: new Date(now.getTime() - 12 * 3_600_000) } }] },
        { OR: [{ projectId: null }, { project: { status: { not: "ARCHIVED" } } }] },
      ],
    },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { number: "desc" }],
    take: 500,
    select: {
      id: true,
      number: true,
      title: true,
      priority: true,
      dueAt: true,
      completedAt: true,
      project: { select: { key: true, name: true } },
      labels: { select: { labelId: true } },
      blockedBy: { where: { type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } }, select: { blockingTaskId: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    title: row.title,
    priority: row.priority,
    dueAt: iso(row.dueAt),
    completedAt: iso(row.completedAt),
    projectKey: row.project?.key ?? null,
    projectName: row.project?.name ?? null,
    labelIds: row.labels.map((l) => l.labelId),
    blocked: row.blockedBy.length > 0,
    url: taskUrl(actor.workspace.slug, row.project?.key, row.number),
  }));
}
