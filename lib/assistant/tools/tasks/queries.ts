import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clip, htmlToText, projectWhere, taskWhere, userNames } from "@/lib/assistant/tools/access";
import { defineTool, plural } from "@/lib/assistant/tools/types";
import { taskRef, taskSelect, taskDto, findVisibleTask } from "./records";

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
