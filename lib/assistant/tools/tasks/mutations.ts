import "server-only";

import type { ColumnCategory, Prisma, TaskPriority } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { taskUrl } from "@/lib/tasks/links";
import { nextWorkspaceSequence } from "@/lib/counters";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { dispatch } from "@/lib/notify";
import { hasRoleAtLeast } from "@/lib/roles";
import { clip, projectWhere, textToHtml } from "@/lib/assistant/tools/access";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, ToolError } from "@/lib/assistant/tools/types";
import { taskRef, taskSelect, taskDto, findVisibleTask } from "./records";

const PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const STATUS_TO_CATEGORY: Record<"todo" | "in_progress" | "done", ColumnCategory> = { todo: "TODO", in_progress: "IN_PROGRESS", done: "DONE" };

const dateInput = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO date such as 2026-11-02 or 2026-11-02T18:00:00+05:30.")
  .describe("ISO 8601 date or date-time.");

/** Active members who may be assigned a task in `project` (private teams: their members and admins). */
async function validAssignees(workspaceId: string, ids: string[], project: { teamId: string | null } | null) {
  if (ids.length === 0) return [];
  const members = await prisma.membership.findMany({
    where: { workspaceId, userId: { in: ids }, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] } },
    select: { userId: true, role: true },
  });
  let allowed = members;
  if (project?.teamId) {
    const team = await prisma.team.findUnique({ where: { id: project.teamId }, select: { visibility: true, members: { select: { userId: true } } } });
    if (team?.visibility === "PRIVATE") {
      const inTeam = new Set(team.members.map((m) => m.userId));
      allowed = members.filter((m) => hasRoleAtLeast(m.role, "ADMIN") || inTeam.has(m.userId));
    }
  }
  if (allowed.length !== ids.length) throw new ToolError("Assign tasks only to active members who can see the project.");
  return allowed.map((m) => m.userId);
}

function parseDue(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

export const createTask = defineTool({
  name: "sw_create_task",
  title: "New task",
  description:
    "Create a task. The person confirms before it runs. Optional project key, plain-text description, assignees (\"me\" or member ids from sw_list_members), priority and due date.",
  input: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional().describe("Plain text."),
    project: z.string().trim().max(10).optional().describe("Project key, e.g. BOT. Leave out for a personal task."),
    assignees: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAt: dateInput.optional(),
  }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const { principal } = ctx;
    const workspaceId = principal.workspace.id;
    const project = input.project
      ? await prisma.project.findFirst({
          where: { AND: [await projectWhere(principal), { key: input.project.toUpperCase(), status: { not: "ARCHIVED" } }] },
          select: { id: true, key: true, name: true, teamId: true, columns: { orderBy: { position: "asc" }, select: { id: true, category: true } } },
        })
      : null;
    if (input.project && !project) throw new ToolError(`No open project ${input.project.toUpperCase()} that you can see.`, "not_found");
    const assigneeIds = await validAssignees(workspaceId, [...new Set((input.assignees ?? []).map((id) => (id === "me" ? principal.userId : id)))], project);
    const column = project ? project.columns.find((c) => c.category === "TODO") ?? project.columns[0] ?? null : null;
    const descriptionHtml = input.description ? textToHtml(input.description) : null;

    const { task, afterCommit } = await prisma.$transaction(async (tx) => {
      const number = await nextWorkspaceSequence(tx, workspaceId, "task");
      const created = await tx.task.create({
        data: {
          workspaceId,
          projectId: project?.id ?? null,
          columnId: column?.id ?? null,
          number,
          title: input.title,
          description: descriptionHtml,
          priority: (input.priority ?? "NONE") as TaskPriority,
          dueAt: parseDue(input.dueAt) ?? null,
          creatorId: principal.userId,
          position: Date.now(),
          assignees: assigneeIds.length ? { create: assigneeIds.map((userId) => ({ userId })) } : undefined,
          activities: { create: { actorId: principal.userId, kind: "created", data: { via: ctx.via } } },
        },
        select: taskSelect,
      });
      const ref = project ? `${project.key}-${number}` : `#${number}`;
      const url = taskUrl(principal.workspace.slug, created.project?.key, created.number);
      await indexSearchDocument(
        { workspaceId, entityType: "task", entityId: created.id, title: `${ref} ${created.title}`, body: input.description ?? "", url, projectId: project?.id ?? null, teamId: project?.teamId ?? null },
        tx,
      );
      await recordActivity({ workspaceId, actorId: principal.userId, verb: "created", entityType: "task", entityId: created.id, summary: `created ${ref} ${created.title}`, projectId: project?.id ?? null, teamId: project?.teamId ?? null }, tx);
      await auditToolWrite(ctx, { action: "assistant.task_created", targetType: "Task", targetId: created.id, metadata: { number } }, tx);
      const recipients = assigneeIds.filter((id) => id !== principal.userId);
      const notified = recipients.length
        ? await dispatch(
            workspaceId,
            {
              type: "task.assigned",
              title: clip(`${principal.userName ?? "Someone"} assigned you ${ref}`, 150),
              body: clip(created.title, 300),
              url,
              actorId: principal.userId,
              recipients,
              resource: { type: "task", id: created.id },
              scope: { ...(project ? { projectId: project.id } : {}), taskId: created.id },
              data: { taskId: created.id, taskNumber: number, projectId: project?.id ?? null },
            },
            { tx },
          )
        : null;
      return { task: created, afterCommit: notified?.afterCommit };
    });
    await afterCommit?.();
    const dto = taskDto(principal.workspace.slug, task);
    return { summary: `Created ${dto.ref}`, data: dto };
  },
});

export const updateTask = defineTool({
  name: "sw_update_task",
  title: "Task update",
  description: "Update a task's title, status (todo, in_progress, done), priority or due date (null clears it). The person confirms before it runs.",
  input: z.object({
    ref: taskRef,
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAt: dateInput.nullable().optional(),
  }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const { principal } = ctx;
    const task = await findVisibleTask(ctx, input.ref);
    const data: Prisma.TaskUncheckedUpdateInput = {};
    const changed: string[] = [];
    if (input.title !== undefined && input.title !== task.title) {
      data.title = input.title;
      changed.push("title");
    }
    if (input.priority !== undefined && input.priority !== task.priority) {
      data.priority = input.priority;
      changed.push("priority");
    }
    const due = parseDue(input.dueAt);
    if (due !== undefined) {
      data.dueAt = due;
      changed.push("due date");
    }
    let fromColumnId: string | null = null;
    let toColumnId: string | null = null;
    if (input.status) {
      const category = STATUS_TO_CATEGORY[input.status];
      if (task.projectId) {
        const current = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, select: { columnId: true } });
        const column = await prisma.boardColumn.findFirst({ where: { projectId: task.projectId, category }, orderBy: { position: "asc" }, select: { id: true } });
        if (column && column.id !== current.columnId) {
          data.columnId = column.id;
          fromColumnId = current.columnId;
          toColumnId = column.id;
        }
      }
      data.completedAt = category === "DONE" ? task.completedAt ?? ctx.now : null;
      changed.push("status");
    }
    if (changed.length === 0) return { summary: `Nothing to change on ${taskDto(principal.workspace.slug, task).ref}`, data: taskDto(principal.workspace.slug, task) };

    const { updated, afterCommit } = await prisma.$transaction(async (tx) => {
      const row = await tx.task.update({ where: { id: task.id }, data, select: taskSelect });
      await tx.taskActivity.create({ data: { taskId: task.id, actorId: principal.userId, kind: "updated", data: { fields: changed, via: ctx.via } } });
      const dto = taskDto(principal.workspace.slug, row);
      if (data.title) {
        await indexSearchDocument(
          { workspaceId: principal.workspace.id, entityType: "task", entityId: row.id, title: `${dto.ref} ${row.title}`, url: dto.url, projectId: row.projectId, teamId: row.project?.teamId ?? null },
          tx,
        );
      }
      await auditToolWrite(ctx, { action: "assistant.task_updated", targetType: "Task", targetId: row.id, metadata: { number: row.number, fields: changed.join(",") } }, tx);
      const recipients = row.assignees.map((a) => a.user.id).filter((id) => id !== principal.userId);
      const notified =
        input.status && recipients.length
          ? await dispatch(
              principal.workspace.id,
              {
                type: "task.status_changed",
                title: clip(`${principal.userName ?? "Someone"} moved ${dto.ref} to ${dto.status}`, 150),
                url: dto.url,
                actorId: principal.userId,
                recipients,
                resource: { type: "task", id: row.id },
                scope: { ...(row.projectId ? { projectId: row.projectId } : {}), taskId: row.id },
                data: { taskId: row.id, taskNumber: row.number, projectId: row.projectId, fromColumnId, toColumnId },
              },
              { tx },
            )
          : null;
      return { updated: dto, afterCommit: notified?.afterCommit };
    });
    await afterCommit?.();
    return { summary: `Updated ${updated.ref} (${changed.join(", ")})`, data: updated };
  },
});
