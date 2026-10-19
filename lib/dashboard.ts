import "server-only";

import type { Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canViewFinance, type RoleHolder } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { latestAnnouncements } from "@/lib/community/summary";

/** Everything the workspace home needs, in one round of parallel queries. Tolerates empty tables. */
export async function getDashboardData(workspace: Workspace, userId: string, membership: RoleHolder) {
  const now = new Date();
  const showFinance = canViewFinance(membership, workspace);
  // Recent activity spans everyone's tasks, so private teams' projects stay out.
  const hidden = membership ? await hiddenTeamIds(workspace.id, { userId, role: membership.role }) : [];
  const visibleProject = hidden.length > 0 ? { OR: [{ projectId: null }, { project: { teamId: null } }, { project: { teamId: { notIn: hidden } } }] } : {};
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
    latestAnnouncements(workspace.id, { take: 3, now }),
    prisma.task.findMany({
      where: { workspaceId: workspace.id, archivedAt: null, ...visibleProject },
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
