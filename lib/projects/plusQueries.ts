import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canManageProjectPlan } from "@/lib/roles";
import { visibleProjectWhere, visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { toDateInputValue } from "@/lib/tasks/localDate";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { isOverdue } from "@/lib/tasks/due";
import { csvCell, milestoneStatus, nextUpdateDue, projectProgress } from "./plusLogic";
import { projectActor } from "./plusService";
import type { ProjectPlan, PlanTask, BlockerRow, UpdateRow } from "./plusTypes";

const taskInclude = {
  project: { select: { id: true, key: true, name: true } },
  assignees: { select: { user: { select: { name: true } } } },
  blockedBy: { where: { type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } }, select: { blockingTask: { select: { id: true, number: true, title: true, project: { select: { key: true } } } } } },
} satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;
async function planTasks(actor: TaskActor, rows: TaskRow[], now: Date): Promise<PlanTask[]> {
  const ids = [...new Set(rows.flatMap(t => t.blockedBy.map(b => b.blockingTask.id)))];
  const visible = new Set((ids.length ? await prisma.task.findMany({ where: { AND: [await visibleTaskWhere(actor), { id: { in: ids } }] }, select: { id: true } }) : []).map(t => t.id));
  const owners = new Map((await prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, userId: { in: rows.flatMap(t => t.blockerOwnerId ? [t.blockerOwnerId] : []) } }, select: { userId: true, user: { select: { name: true } } } })).map(m => [m.userId, m.user.name]));
  return rows.map(t => ({
    id: t.id, title: t.title, reference: taskReference(t.project?.key, t.number), url: taskUrl(actor.workspace.slug, t.project?.key, t.number), parentId: t.parentId,
    start: t.startsOn?.toISOString().slice(0, 10) ?? null, end: t.dueAt ? toDateInputValue(t.dueAt, actor.workspace.timezone) : null,
    done: Boolean(t.completedAt), overdue: isOverdue(t.dueAt, t.completedAt, now, actor.workspace.timezone),
    blockerReason: t.blockerReason, blockerOwnerId: t.blockerOwnerId,
    owner: t.blockerOwnerId ? owners.get(t.blockerOwnerId) ?? "Former member" : t.assignees.map(a => a.user.name ?? "Former member").join(", ") || "Unassigned",
    blockedBy: t.blockedBy.filter(b => visible.has(b.blockingTask.id)).map(({ blockingTask: b }) => ({ reference: taskReference(b.project?.key, b.number), title: b.title, url: taskUrl(actor.workspace.slug, b.project?.key, b.number) })),
    restrictedBlocker: t.blockedBy.some(b => !visible.has(b.blockingTask.id)),
  }));
}
export async function projectUpdates(actor: TaskActor, projectId: string, page = 0): Promise<UpdateRow[]> {
  const fresh = await projectActor(actor);
  if (!fresh || !await prisma.project.findFirst({ where: { AND: [await visibleProjectWhere(fresh), { id: projectId }] } })) return [];
  const rows = await prisma.projectStatusUpdate.findMany({ where: { workspaceId: fresh.workspace.id, projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: Math.max(0, Math.min(10000, page)) * 20, take: 20 });
  const members = new Map((await prisma.membership.findMany({ where: { workspaceId: fresh.workspace.id, userId: { in: rows.flatMap(r => r.authorId ? [r.authorId] : []) } }, select: { userId: true, user: { select: { name: true } } } })).map(m => [m.userId, m.user.name]));
  return rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString(), author: r.authorId ? members.get(r.authorId) ?? "Former member" : "Former member" }));
}
export async function getProjectPlan(actor: TaskActor, key: string, now = new Date()): Promise<ProjectPlan | null> {
  const fresh = await projectActor(actor);
  if (!fresh) return null;
  const project = await prisma.project.findFirst({ where: { AND: [await visibleProjectWhere(fresh), { key: key.toUpperCase() }] }, include: { owner: { select: { name: true } } } });
  if (!project) return null;
  const [rows, milestones, updates] = await Promise.all([
    prisma.task.findMany({ where: { workspaceId: fresh.workspace.id, projectId: project.id, archivedAt: null }, orderBy: [{ startsOn: "asc" }, { dueAt: "asc" }, { number: "asc" }], include: taskInclude }),
    prisma.projectMilestone.findMany({ where: { workspaceId: fresh.workspace.id, projectId: project.id }, orderBy: [{ targetOn: "asc" }, { id: "asc" }], include: { tasks: { include: { task: { select: { id: true, title: true, completedAt: true, archivedAt: true } } } } } }),
    projectUpdates(fresh, project.id),
  ]);
  const due = nextUpdateDue(updates[0] ? new Date(updates[0].createdAt) : project.createdAt, fresh.workspace.timezone);
  return {
    projectId: project.id, name: project.name, key: project.key, base: `/w/${fresh.workspace.slug}/projects/${project.key}`, timeZone: fresh.workspace.timezone,
    lead: project.owner?.name ?? "No lead assigned", startsOn: project.startsOn?.toISOString().slice(0, 10) ?? null, dueOn: project.dueOn?.toISOString().slice(0, 10) ?? null,
    canManage: project.status !== "ARCHIVED" && canManageProjectPlan(fresh.membership, fresh.user.id, project.ownerId),
    tasks: await planTasks(fresh, rows, now), progress: projectProgress(rows), updates,
    milestones: milestones.map(m => ({ id: m.id, name: m.name, targetOn: m.targetOn.toISOString().slice(0, 10), status: milestoneStatus(m.status, m.tasks.map(t => t.task)), manualStatus: m.status, notes: m.notes, taskIds: m.tasks.map(t => t.taskId), tasks: m.tasks.map(({ task: t }) => ({ id: t.id, title: t.title, done: Boolean(t.completedAt), archived: Boolean(t.archivedAt) })) })),
    updateDueAt: due.toISOString(), updateOverdue: project.status === "ACTIVE" && due <= now,
  };
}
export async function listProjectBlockers(actor: TaskActor): Promise<BlockerRow[]> {
  const fresh = await projectActor(actor);
  if (!fresh) return [];
  const rows = await prisma.task.findMany({ where: { AND: [await visibleTaskWhere(fresh), { project: { status: { in: ["ACTIVE", "PAUSED"] } }, completedAt: null, archivedAt: null, OR: [{ blockerReason: { not: null } }, { blockedBy: { some: { workspaceId: fresh.workspace.id, type: "BLOCKS", blockingTask: { completedAt: null, archivedAt: null } } } }] }] }, include: taskInclude, orderBy: [{ dueAt: "asc" }, { number: "asc" }] });
  const tasks = await planTasks(fresh, rows, new Date());
  return tasks.map((t, i) => ({ ...t, projectName: rows[i].project!.name, projectKey: rows[i].project!.key, projectId: rows[i].project!.id }));
}
export function projectReportCsv(plan: ProjectPlan) {
  const rows: unknown[][] = [["Section", "Reference", "Name / note", "Status", "Start", "Due / date", "Owner", "Progress", "Blockers", "Next steps", "Notes"], ["Project", plan.key, plan.name, plan.updates[0]?.status ?? "No update", plan.startsOn, plan.dueOn, plan.lead, `${plan.progress.percent}%`]];
  for (const m of plan.milestones) rows.push(["Milestone", "", m.name, m.status, "", m.targetOn, "", `${m.tasks.filter(t => t.done).length}/${m.tasks.length}`, "", "", m.notes]);
  for (const t of plan.tasks) rows.push([t.overdue ? "Overdue task" : "Task", t.reference, t.title, t.done ? "Done" : t.blockerReason || t.blockedBy.length || t.restrictedBlocker ? "Blocked" : "Open", t.start, t.end, t.owner, "", [t.blockerReason, ...t.blockedBy.map(b => b.reference), t.restrictedBlocker ? "Restricted dependency" : ""].filter(Boolean).join("; ")]);
  for (const u of plan.updates.slice(0, 8)) rows.push(["Update", "", u.note, u.status, "", u.createdAt, u.author, "", u.blockers.join("; "), u.nextSteps.join("; ")]);
  return rows.map(row => Array.from({ length: rows[0].length }, (_, index) => csvCell(row[index])).join(",")).join("\r\n");
}
