import "server-only";

import type { Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canViewFinance, type RoleHolder } from "@/lib/roles";

/** Everything the workspace home needs, in one round of parallel queries. Tolerates empty tables. */
export async function getDashboardData(workspace: Workspace, userId: string, membership: RoleHolder) {
  const now = new Date();
  const showFinance = canViewFinance(membership, workspace);
  const [myOpenTasks, myTasks, memberCount, upcomingEvents, announcements, recentTasks, recentShoutouts, ledger] = await Promise.all([
    prisma.task.count({ where: { workspaceId: workspace.id, completedAt: null, archivedAt: null, assignees: { some: { userId } } } }),
    prisma.task.findMany({
      where: { workspaceId: workspace.id, completedAt: null, archivedAt: null, assignees: { some: { userId } } },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 6,
      select: { id: true, number: true, title: true, priority: true, dueAt: true, project: { select: { key: true, name: true } } },
    }),
    prisma.membership.count({ where: { workspaceId: workspace.id, status: "ACTIVE" } }),
    prisma.communityEvent.findMany({
      where: { workspaceId: workspace.id, cancelledAt: null, startsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 4,
      select: { id: true, title: true, startsAt: true, kind: true, location: true },
    }),
    prisma.announcement.findMany({
      where: { workspaceId: workspace.id, publishedAt: { not: null, lte: now } },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: 3,
      select: { id: true, title: true, body: true, pinned: true, publishedAt: true, author: { select: { name: true } } },
    }),
    prisma.task.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, number: true, title: true, updatedAt: true, completedAt: true, project: { select: { key: true } } },
    }),
    prisma.shoutout.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { id: true, message: true, createdAt: true, from: { select: { name: true } }, to: { select: { name: true } } },
    }),
    showFinance
      ? prisma.ledgerEntry.groupBy({ by: ["kind"], where: { workspaceId: workspace.id, voidedAt: null, currency: workspace.currency }, _sum: { amountMinor: true } })
      : Promise.resolve(null),
  ]);
  const kittyMinor = ledger
    ? ledger.reduce((total, row) => total + (row.kind === "INCOME" ? 1 : -1) * (row._sum.amountMinor ?? 0), 0)
    : null;
  return { myOpenTasks, myTasks, memberCount, upcomingEvents, announcements, recentTasks, recentShoutouts, kittyMinor };
}
