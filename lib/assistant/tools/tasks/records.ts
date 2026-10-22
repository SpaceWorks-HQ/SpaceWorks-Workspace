import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { taskUrl } from "@/lib/tasks/links";
import { taskWhere } from "@/lib/assistant/tools/access";
import { ToolError, type ToolContext } from "@/lib/assistant/tools/types";

export const taskRef = z.string().trim().min(1).max(40).describe('Task reference: "BOT-12", "#12" or "12".');

export function parseTaskNumber(ref: string): number | null {
  const match = /^(?:[A-Za-z][A-Za-z0-9]{0,9}-|#)?(\d{1,9})$/.exec(ref.trim());
  return match ? Number(match[1]) : null;
}

export const taskSelect = {
  id: true,
  number: true,
  title: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  projectId: true,
  project: { select: { key: true, name: true, teamId: true } },
  column: { select: { name: true, category: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export function taskDto(slug: string, task: TaskRow) {
  return {
    ref: task.project ? `${task.project.key}-${task.number}` : `#${task.number}`,
    number: task.number,
    title: task.title,
    status: task.completedAt || task.column?.category === "DONE" ? "done" : task.column?.category === "IN_PROGRESS" ? "in progress" : "to do",
    column: task.column?.name ?? null,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    project: task.project ? { key: task.project.key, name: task.project.name } : null,
    assignees: task.assignees.map((a) => ({ id: a.user.id, name: a.user.name })),
    url: taskUrl(slug, task.project?.key, task.number),
  };
}

export async function findVisibleTask(ctx: ToolContext, ref: string) {
  const number = parseTaskNumber(ref);
  if (number === null) throw new ToolError('Use a task reference such as "BOT-12".');
  const task = await prisma.task.findFirst({ where: { AND: [await taskWhere(ctx.principal), { number }] }, select: taskSelect });
  if (!task) throw new ToolError(`No task ${ref} that you can see.`, "not_found");
  return task;
}
