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
import { clip, htmlToText, projectWhere, taskWhere, textToHtml, userNames } from "@/lib/assistant/tools/access";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, plural, ToolError, type ToolContext } from "@/lib/assistant/tools/types";

const PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const STATUS_TO_CATEGORY: Record<"todo" | "in_progress" | "done", ColumnCategory> = { todo: "TODO", in_progress: "IN_PROGRESS", done: "DONE" };

const taskRef = z.string().trim().min(1).max(40).describe('Task reference: "BOT-12", "#12" or "12".');
const dateInput = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO date such as 2026-11-02 or 2026-11-02T18:00:00+05:30.")
  .describe("ISO 8601 date or date-time.");

export function parseTaskNumber(ref: string): number | null {
  const match = /^(?:[A-Za-z][A-Za-z0-9]{0,9}-|#)?(\d{1,9})$/.exec(ref.trim());
  return match ? Number(match[1]) : null;
}

const taskSelect = {
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

function taskDto(slug: string, task: TaskRow) {
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

async function findVisibleTask(ctx: ToolContext, ref: string) {
  const number = parseTaskNumber(ref);
  if (number === null) throw new ToolError('Use a task reference such as "BOT-12".');
  const task = await prisma.task.findFirst({ where: { AND: [await taskWhere(ctx.principal), { number }] }, select: taskSelect });
  if (!task) throw new ToolError(`No task ${ref} that you can see.`, "not_found");
  return task;
}

export const listTasks = defineTool({
  name: "sw_list_tasks",
  title: "Tasks",
  description:
    "List tasks in the workspace the caller can see. Filter by project key, assignee (\"me\" or a member id from sw_list_members), status, due window or a title search. Returns at most `limit` tasks plus `nextCursor` for the next page.",
  input: z.object({
    project: z.string().trim().max(10).optional().describe("Project key, e.g. BOT."),
    assignee: z.string().trim().max(64).optional().describe('"me" or a member id.'),
    status: z.enum(["open", "done", "all"]).default("open"),
    dueWithinDays: z.number().int().min(0).max(365).optional().describe("Only tasks due within this many days (includes overdue)."),
    query: z.string().trim().max(100).optional().describe("Words in the task title."),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().max(64).optional(),
  }),
  write: false,
  scope: "read:tasks",
  minRole: "GUEST",
  async run(ctx, input) {
    const { principal } = ctx;
    const and: Prisma.TaskWhereInput[] = [await taskWhere(principal)];
    if (input.project) and.push({ project: { key: input.project.toUpperCase() } });
    if (input.assignee) and.push({ assignees: { some: { userId: input.assignee === "me" ? principal.userId : input.assignee } } });
    if (input.status === "open") and.push({ completedAt: null, NOT: { column: { category: "DONE" } } });
    if (input.status === "done") and.push({ OR: [{ completedAt: { not: null } }, { column: { category: "DONE" } }] });
    if (input.dueWithinDays !== undefined) and.push({ dueAt: { lte: new Date(ctx.now.getTime() + input.dueWithinDays * 86_400_000) } });
    if (input.query) and.push({ title: { contains: input.query, mode: "insensitive" } });
    const rows = await prisma.task.findMany({
      where: { AND: and },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { number: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: taskSelect,
    });
    const page = rows.slice(0, input.limit);
    return {
      summary: `Looked up ${plural(page.length, "task")}`,
      data: { tasks: page.map((task) => taskDto(principal.workspace.slug, task)), nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null },
    };
  },
});

export const getTask = defineTool({
  name: "sw_get_task",
  title: "Task",
  description: "Get one task with its description, assignees, labels and latest comments.",
  input: z.object({ ref: taskRef }),
  write: false,
  scope: "read:tasks",
  minRole: "GUEST",
  async run(ctx, input) {
    const task = await findVisibleTask(ctx, input.ref);
    const detail = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: {
        description: true,
        creatorId: true,
        labels: { select: { label: { select: { name: true } } } },
        comments: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { body: true, authorId: true, createdAt: true } },
        subtasks: { where: { archivedAt: null }, select: { number: true, title: true, completedAt: true }, take: 20 },
      },
    });
    const names = await userNames([detail.creatorId, ...detail.comments.map((c) => c.authorId)]);
    return {
      summary: `Opened ${taskDto(ctx.principal.workspace.slug, task).ref}`,
      data: {
        ...taskDto(ctx.principal.workspace.slug, task),
        description: clip(htmlToText(detail.description), 4000),
        createdBy: detail.creatorId ? names.get(detail.creatorId) ?? "Former member" : null,
        createdAt: task.createdAt.toISOString(),
        labels: detail.labels.map((l) => l.label.name),
        subtasks: detail.subtasks.map((s) => ({ number: s.number, title: s.title, done: Boolean(s.completedAt) })),
        latestComments: detail.comments.map((c) => ({
          author: c.authorId ? names.get(c.authorId) ?? "Former member" : "Former member",
          at: c.createdAt.toISOString(),
          body: clip(htmlToText(c.body), 600),
        })),
      },
    };
  },
});

export const listProjects = defineTool({
  name: "sw_list_projects",
  title: "Projects",
  description: "List projects (key, name, status, owner, open task count).",
  input: z.object({
    status: z.enum(["ACTIVE", "PAUSED", "DONE", "ARCHIVED", "any"]).default("ACTIVE"),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().max(64).optional(),
  }),
  write: false,
  scope: "read:tasks",
  minRole: "GUEST",
  async run(ctx, input) {
    const where: Prisma.ProjectWhereInput = { ...(await projectWhere(ctx.principal)), ...(input.status === "any" ? {} : { status: input.status }) };
    const rows = await prisma.project.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        status: true,
        dueOn: true,
        owner: { select: { name: true } },
        _count: { select: { tasks: { where: { archivedAt: null, completedAt: null } } } },
      },
    });
    const page = rows.slice(0, input.limit);
    return {
      summary: `Looked up ${plural(page.length, "project")}`,
      data: {
        projects: page.map((p) => ({
          key: p.key,
          name: p.name,
          description: p.description ? clip(p.description, 300) : null,
          status: p.status,
          dueOn: p.dueOn?.toISOString().slice(0, 10) ?? null,
          owner: p.owner?.name ?? null,
          openTasks: p._count.tasks,
          url: `/w/${ctx.principal.workspace.slug}/projects/${p.key}`,
        })),
        nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      },
    };
  },
});

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

export const TASK_TOOLS = [listTasks, getTask, listProjects, createTask, updateTask];
