import "server-only";
import { prisma } from "@/lib/db";
import { visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { taskUrl } from "@/lib/tasks/links";
import type { MyTaskDTO } from "@/lib/tasks/types";
import { iso } from "./formatters";

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
      blockerReason: true,
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
    blocked: Boolean(row.blockerReason) || row.blockedBy.length > 0,
    url: taskUrl(actor.workspace.slug, row.project?.key, row.number),
  }));
}
