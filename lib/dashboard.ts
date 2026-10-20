import "server-only";
import type { Prisma, Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  canViewFinance,
  canViewAppReviews,
  canViewServices,
  canContribute,
  type RoleHolder,
} from "@/lib/roles";
import { hiddenTeamIds, teamScopeFilter, userTeamIds } from "@/lib/teamAccess";
import { latestAnnouncements } from "@/lib/community/summary";
import { listActivity } from "@/lib/search/query";
export async function getDashboardData(
  workspace: Workspace,
  userId: string,
  membership: RoleHolder,
) {
  const now = new Date();
  const actor = { workspaceId: workspace.id, userId, role: membership!.role };
  const [hidden, teams] = await Promise.all([
    hiddenTeamIds(workspace.id, actor),
    userTeamIds(workspace.id, userId),
  ]);
  const project: Prisma.TaskWhereInput = {
    OR: [
      { projectId: null },
      {
        project: {
          workspaceId: workspace.id,
          ...teamScopeFilter(hidden),
          status: { not: "ARCHIVED" },
        },
      },
    ],
  };
  const mine: Prisma.TaskWhereInput = {
    workspaceId: workspace.id,
    completedAt: null,
    archivedAt: null,
    assignees: { some: { userId } },
    ...project,
  };
  const [
    myOpenTasks,
    myTasks,
    memberCount,
    announcements,
    activity,
    ledger,
    shifts,
    meetings,
    mentions,
    services,
    unrepliedLowRatings,
  ] = await Promise.all([
    canContribute(membership) ? prisma.task.count({ where: mine }) : 0,
    canContribute(membership)
      ? prisma.task.findMany({
          where: mine,
          orderBy: [
            { dueAt: { sort: "asc", nulls: "last" } },
            { updatedAt: "desc" },
          ],
          take: 6,
          select: {
            id: true,
            number: true,
            title: true,
            dueAt: true,
            project: { select: { key: true } },
          },
        })
      : [],
    prisma.membership.count({
      where: { workspaceId: workspace.id, status: "ACTIVE" },
    }),
    latestAnnouncements(workspace.id, { take: 3, now }),
    listActivity(actor),
    canViewFinance(membership, workspace)
      ? prisma.ledgerEntry.groupBy({
          by: ["kind"],
          where: {
            workspaceId: workspace.id,
            voidedAt: null,
            currency: workspace.currency,
          },
          _sum: { amountMinor: true },
        })
      : null,
    canContribute(membership)
      ? prisma.shift.findMany({
          where: {
            workspaceId: workspace.id,
            endsAt: { gte: now },
            shiftType: {
              workspaceId: workspace.id,
              ...teamScopeFilter(hidden),
            },
            assignments: {
              some: { userId, status: { in: ["CONFIRMED", "SWAP_REQUESTED"] } },
            },
          },
          orderBy: { startsAt: "asc" },
          take: 4,
          select: {
            id: true,
            startsAt: true,
            shiftType: { select: { name: true } },
          },
        })
      : [],
    prisma.meeting.findMany({
      where: {
        workspaceId: workspace.id,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        startsAt: { gte: now },
        AND: [
          teamScopeFilter(hidden),
          {
            OR: [
              { visibility: "WORKSPACE" },
              { createdById: userId },
              { attendees: { some: { userId, rsvp: { not: "NO" } } } },
              { visibility: "TEAM", teamId: { in: teams } },
            ],
          },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: 4,
      select: { id: true, title: true, startsAt: true },
    }),
    prisma.notification.findMany({
      where: {
        workspaceId: workspace.id,
        userId,
        kind: "mention",
        archivedAt: null,
        readAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, title: true, url: true },
    }),
    canViewServices(membership)
      ? prisma.monitor.groupBy({
          by: ["lastStatus"],
          where: {
            workspaceId: workspace.id,
            OR: [
              { projectId: null },
              {
                project: {
                  workspaceId: workspace.id,
                  ...teamScopeFilter(hidden),
                },
              },
            ],
          },
          _count: true,
        })
      : [],
    canViewAppReviews(membership) ? prisma.appReview.count({ where: { workspaceId: workspace.id, rating: { lte: 2 }, replyStatus: { not: "SENT" } } }) : null,
  ]);
  const kittyMinor = ledger
    ? ledger.reduce(
        (total, row) =>
          total +
          (row.kind === "INCOME" ? 1 : -1) * (row._sum.amountMinor ?? 0),
        0,
      )
    : null;
  return {
    myOpenTasks,
    myTasks,
    memberCount,
    announcements,
    activity: activity.slice(0, 8),
    kittyMinor,
    shifts,
    meetings,
    mentions,
    services,
    unrepliedLowRatings,
    now,
  };
}
