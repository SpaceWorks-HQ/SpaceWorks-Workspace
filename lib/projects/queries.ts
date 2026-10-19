import "server-only";

import type { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { visibleProjectWhere, type TaskActor } from "@/lib/tasks/access";
import { activityText, HIDDEN_ACTIVITY_KINDS } from "@/lib/tasks/activityText";
import { localDayNumber, localToInstant } from "@/lib/tasks/localDate";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import type { PersonRef } from "@/lib/tasks/types";

/** Read models for the projects list and the project overview. */

export type ProjectStatusFilter = "open" | "ACTIVE" | "PAUSED" | "DONE" | "ARCHIVED" | "all";

export const PROJECT_STATUS_FILTERS: ReadonlyArray<{ value: ProjectStatusFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "DONE", label: "Done" },
  { value: "ARCHIVED", label: "Archived" },
  { value: "all", label: "All" },
];

export function parseStatusFilter(value: string | string[] | undefined): ProjectStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return PROJECT_STATUS_FILTERS.some((option) => option.value === raw) ? (raw as ProjectStatusFilter) : "open";
}

export type ProjectListRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  owner: PersonRef | null;
  teamName: string | null;
  dueOn: string | null;
  total: number;
  done: number;
  overdue: number;
  updatedAt: string;
};

export async function listProjects(actor: TaskActor, filter: ProjectStatusFilter, now: Date = new Date()): Promise<ProjectListRow[]> {
  const statusWhere =
    filter === "open" ? { status: { in: ["ACTIVE", "PAUSED"] as ProjectStatus[] } } : filter === "all" ? { status: { not: "ARCHIVED" as ProjectStatus } } : { status: filter };
  const projects = await prisma.project.findMany({
    where: { AND: [await visibleProjectWhere(actor), statusWhere] },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
    include: { owner: { select: { id: true, name: true, image: true } }, team: { select: { name: true } } },
  });
  if (projects.length === 0) return [];
  const ids = projects.map((project) => project.id);
  const today = localToInstant(localDayNumber(now, actor.workspace.timezone), 0, 0, actor.workspace.timezone);
  const base = { projectId: { in: ids }, parentId: null, archivedAt: null };
  const [totals, done, overdue] = await Promise.all([
    prisma.task.groupBy({ by: ["projectId"], where: base, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { ...base, completedAt: { not: null } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { ...base, completedAt: null, dueAt: { lt: today } }, _count: { _all: true } }),
  ]);
  const count = (rows: Array<{ projectId: string | null; _count: { _all: number } }>, id: string) => rows.find((row) => row.projectId === id)?._count._all ?? 0;
  return projects.map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    status: project.status,
    owner: project.owner,
    teamName: project.team?.name ?? null,
    dueOn: project.dueOn ? project.dueOn.toISOString().slice(0, 10) : null,
    total: count(totals, project.id),
    done: count(done, project.id),
    overdue: count(overdue, project.id),
    updatedAt: project.updatedAt.toISOString(),
  }));
}

export async function getProjectOverview(actor: TaskActor, project: { id: string; key: string }, now: Date = new Date()) {
  const timeZone = actor.workspace.timezone;
  const today = localToInstant(localDayNumber(now, timeZone), 0, 0, timeZone);
  const base = { projectId: project.id, parentId: null, archivedAt: null };
  const [columns, byColumn, overdue, upcoming, workload, activity] = await Promise.all([
    prisma.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } }),
    prisma.task.groupBy({ by: ["columnId"], where: base, _count: { _all: true } }),
    prisma.task.count({ where: { ...base, completedAt: null, dueAt: { lt: today } } }),
    prisma.task.findMany({
      where: { ...base, completedAt: null, dueAt: { not: null } },
      orderBy: { dueAt: "asc" },
      take: 6,
      select: { id: true, number: true, title: true, dueAt: true, priority: true },
    }),
    prisma.taskAssignee.groupBy({ by: ["userId"], where: { task: { ...base, completedAt: null } }, _count: { _all: true }, orderBy: { _count: { userId: "desc" } }, take: 8 }),
    prisma.taskActivity.findMany({
      where: { task: { projectId: project.id }, kind: { notIn: [...HIDDEN_ACTIVITY_KINDS] } },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, kind: true, data: true, createdAt: true, actorId: true, task: { select: { number: true, title: true } } },
    }),
  ]);
  const ids = [...workload.map((row) => row.userId), ...activity.map((row) => row.actorId ?? "")].filter(Boolean);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } })).map((user) => [user.id, user]));
  const nameOf = (id: string) => users.get(id)?.name ?? "a former member";
  return {
    columns: columns.map((column) => ({ ...column, count: byColumn.find((row) => row.columnId === column.id)?._count._all ?? 0 })),
    overdue,
    upcoming: upcoming.map((task) => ({ ...task, dueAt: task.dueAt!.toISOString(), reference: taskReference(project.key, task.number), url: taskUrl(actor.workspace.slug, project.key, task.number) })),
    workload: workload.map((row) => ({ person: users.get(row.userId) ?? { id: row.userId, name: null, image: null }, open: row._count._all })),
    activity: activity.map((row) => ({
      id: row.id,
      actor: row.actorId ? (users.get(row.actorId) ?? null) : null,
      text: activityText(row.kind, row.data as Record<string, unknown> | null, { nameOf, timeZone }),
      reference: taskReference(project.key, row.task.number),
      taskTitle: row.task.title,
      url: taskUrl(actor.workspace.slug, project.key, row.task.number),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
