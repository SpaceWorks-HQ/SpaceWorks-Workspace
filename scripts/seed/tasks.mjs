#!/usr/bin/env node
// Demo data for the tasks area, layered on the "TinkerSpace Kochi" demo
// workspace from scripts/seed-demo.mjs (run that first):
//
//   node --env-file-if-exists=.env scripts/seed/tasks.mjs
//
// Adds a "Space upkeep" project with a weekly recurring task, subtasks,
// a dependency and a comment with a mention on the BOT board. Idempotent:
// re-running replaces the OPS project and the extras it created.
// Refuses to run with NODE_ENV=production.
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("Demo seeds are for local development only.");

const prisma = new PrismaClient();
const SLUG = "tinkerspace-kochi";
const DOMAIN = "@tinkerspace.test";
const GAP = 1024;

async function nextNumber(workspaceId) {
  const rows = await prisma.$queryRaw`
    INSERT INTO "WorkspaceCounter" ("workspaceId", "name", "value") VALUES (${workspaceId}, 'task', 1)
    ON CONFLICT ("workspaceId", "name") DO UPDATE SET "value" = "WorkspaceCounter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

/** 09:00 IST `days` from today. */
function at9(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(3, 30, 0, 0);
  return date;
}

/** Start of the IST day `days` from today. */
function day(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(-5, -30, 0, 0);
  return date;
}

async function main() {
  const workspace = await prisma.workspace.findUnique({ where: { slug: SLUG } });
  if (!workspace) throw new Error("Run scripts/seed-demo.mjs first.");
  const users = Object.fromEntries((await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } } })).map((user) => [user.email.split("@")[0], user]));

  // Replace earlier runs.
  const old = await prisma.project.findUnique({ where: { workspaceId_key: { workspaceId: workspace.id, key: "OPS" } } });
  if (old) {
    await prisma.searchDocument.deleteMany({ where: { projectId: old.id } });
    await prisma.task.deleteMany({ where: { projectId: old.id } });
    await prisma.project.delete({ where: { id: old.id } });
  }

  const ops = await prisma.project.create({
    data: { workspaceId: workspace.id, key: "OPS", name: "Space upkeep", description: "Keeping the workshop clean, stocked and safe.", ownerId: users.admin.id },
  });
  const columns = [];
  for (const [position, column] of [["To do", "TODO"], ["Doing", "IN_PROGRESS"], ["Done", "DONE"]].entries()) {
    columns.push(await prisma.boardColumn.create({ data: { projectId: ops.id, name: column[0], category: column[1], position } }));
  }

  const make = async (data) => {
    const number = await nextNumber(workspace.id);
    const task = await prisma.task.create({ data: { workspaceId: workspace.id, number, creatorId: users.admin.id, ...data, activities: { create: { actorId: users.admin.id, kind: "created" } } } });
    await prisma.searchDocument.upsert({
      where: { entityType_entityId: { entityType: "task", entityId: task.id } },
      create: { workspaceId: workspace.id, entityType: "task", entityId: task.id, title: `OPS-${number} ${task.title}`, url: `/w/${SLUG}/projects/OPS/${number}`, projectId: ops.id, ownerId: users.admin.id },
      update: {},
    });
    return task;
  };

  const sweep = await make({ projectId: ops.id, columnId: columns[0].id, title: "Sweep the workbench area", priority: "MEDIUM", position: GAP, dueAt: day(1), assignees: { create: [{ userId: users.joel.id }] } });
  await prisma.taskRecurrence.create({
    data: {
      workspaceId: workspace.id,
      templateTaskId: sweep.id,
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      timezone: "Asia/Kolkata",
      createMode: "ON_SCHEDULE",
      assigneeRule: { type: "ROTATE", userIds: [users.joel.id, users.meera.id, users.fathima.id], index: 1 },
      dueOffsetDays: 0,
      // Next Saturday, 09:00 IST.
      nextRunAt: at9((6 - new Date().getUTCDay() + 7) % 7 || 7),
      createdById: users.admin.id,
    },
  });
  const restock = await make({ projectId: ops.id, columnId: columns[1].id, title: "Restock the soldering station", position: GAP, assignees: { create: [{ userId: users.meera.id }] } });
  for (const [index, title] of ["Solder wire 0.8 mm", "Flux pen", "Brass tip cleaner"].entries()) {
    await make({ projectId: ops.id, parentId: restock.id, title, position: (index + 1) * GAP, completedAt: index === 0 ? new Date() : null });
  }
  const audit = await make({ projectId: ops.id, columnId: columns[0].id, title: "Quarterly key and fob audit", priority: "HIGH", position: GAP * 2, dueAt: day(10), assignees: { create: [{ userId: users.admin.id }] } });
  await prisma.taskDependency.create({ data: { workspaceId: workspace.id, blockingTaskId: restock.id, blockedTaskId: audit.id, createdById: users.admin.id } });
  await prisma.taskComment.create({ data: { taskId: restock.id, authorId: users.admin.id, body: `Ordered from the market. <@${users.meera.id}> can you pick it up on Saturday?` } });

  console.log(`Seeded the OPS project (${ops.name}) with a weekly repeat, subtasks and a dependency.`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
