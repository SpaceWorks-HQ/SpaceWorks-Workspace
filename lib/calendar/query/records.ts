import "server-only";

import { templateWhere } from "@/lib/templates/service";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/meetings/core";
import { visibleTaskWhere, visibleProjectWhere } from "@/lib/tasks/access";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { assertCalendarReader, calendarMeetingWhere, entryWhere } from "../access";

export async function loadCalendarRecords(actor: Actor, start: Date, end: Date) {
  await assertCalendarReader(actor);
  const workspaceId = actor.workspace.id,
    guest = actor.membership.role === "GUEST";
  const hidden = await hiddenTeamIds(workspaceId, {
    userId: actor.user.id,
    role: actor.membership.role,
  });
  const scope = teamScopeFilter(hidden);
  const [
    meetings,
    tasks,
    availability,
    shifts,
    cycles,
    subscriptions,
    vault,
    maintenance,
    entries,
    people,
    teams,
    projects,
    templates,
  ] = await Promise.all([
    prisma.meeting.findMany({
      where: {
        AND: [
          await calendarMeetingWhere(actor),
          {
            startsAt: { lt: end },
            OR: [
              { endsAt: { gte: start } },
              { endsAt: null, startsAt: { gte: start } },
            ],
          },
        ],
      },
      include: {
        calendarSyncs: { where: { userId: actor.user.id }, select: { lastError: true } },
        attendees: { select: { userId: true, rsvp: true } },
        agenda: {
          select: { id: true, title: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 1000,
    }),
    prisma.task.findMany({
      where: {
        AND: [
          await visibleTaskWhere(actor),
          {
            workspaceId,
            archivedAt: null,
            dueAt: { gte: start, lt: end },
            OR: [
              { projectId: null },
              { project: { workspaceId, status: { not: "ARCHIVED" } } },
            ],
          },
          ...(guest
            ? [
                {
                  OR: [
                    { creatorId: actor.user.id },
                    { assignees: { some: { userId: actor.user.id } } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        project: { select: { key: true, teamId: true } },
        assignees: {
          include: { user: { select: { name: true, image: true } } },
        },
      },
      take: 1000,
    }),
    guest
      ? []
      : prisma.availability.findMany({
          where: {
            workspaceId,
            startsAt: { lt: end },
            endsAt: { gt: start },
            OR: [
              { visibility: "WORKSPACE" },
              { userId: actor.user.id },
              ...(actor.membership.role === "ADMIN" ||
              actor.membership.role === "OWNER"
                ? [{ visibility: "PRIVATE" as const }]
                : []),
            ],
          },
          take: 1000,
        }),
    guest
      ? []
      : prisma.shift.findMany({
          where: {
            workspaceId,
            startsAt: { lt: end },
            endsAt: { gt: start },
            shiftType: { workspaceId, ...scope },
          },
          include: {
            shiftType: true,
            assignments: {
              where: { status: { in: ["CONFIRMED", "SWAP_REQUESTED"] } },
              select: { userId: true },
            },
          },
          take: 1000,
        }),
    guest
      ? []
      : prisma.cycle.findMany({
          where: {
            workspaceId,
            AND: [
              scope,
              {
                OR: [
                  { startsAt: { gte: start, lt: end } },
                  { endsAt: { gte: start, lt: end } },
                ],
              },
            ],
            OR: [
              { projectId: null },
              {
                project: { workspaceId, status: { not: "ARCHIVED" }, ...scope },
              },
            ],
          },
          take: 1000,
        }),
    guest
      ? []
      : prisma.subscription.findMany({
          where: {
            workspaceId,
            ...scope,
            status: "ACTIVE",
            nextRenewalAt: { gte: start, lt: end },
          },
          select: {
            id: true,
            name: true,
            nextRenewalAt: true,
            teamId: true,
            ownerId: true,
          },
          take: 1000,
        }),
    guest
      ? []
      : prisma.vaultItem.findMany({
          where: {
            workspaceId,
            ownerId: actor.user.id,
            deletedAt: null,
            rotateEveryDays: { not: null },
          },
          select: {
            id: true,
            title: true,
            lastRotatedAt: true,
            createdAt: true,
            rotateEveryDays: true,
          },
          take: 1000,
        }),
    guest
      ? []
      : prisma.maintenanceWindow.findMany({
          where: {
            workspaceId,
            OR: [
              { startsAt: { lt: end }, endsAt: { gt: start } },
              { rrule: { not: null } },
            ],
          },
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            rrule: true,
            durationMin: true,
            timezone: true,
          },
          take: 1000,
        }),
    prisma.calendarEntry.findMany({
      where: {
        AND: [
          await entryWhere(actor),
          { startsAt: { lt: end }, endsAt: { gte: start } },
        ],
      },
      take: 1000,
    }),
    guest
      ? []
      : prisma.membership.findMany({
          where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } },
          select: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { user: { name: "asc" } },
        }),
    guest
      ? []
      : prisma.team.findMany({
          where: { workspaceId, archivedAt: null, id: { notIn: hidden } },
          select: {
            id: true,
            name: true,
            members: { select: { userId: true } },
          },
        }),
    guest
      ? []
      : prisma.project.findMany({
          where: {
            AND: [
              await visibleProjectWhere(actor),
              { status: { not: "ARCHIVED" } },
            ],
          },
          select: { id: true, name: true, teamId: true },
        }),
    guest
      ? []
      : prisma.template.findMany({
          where: {
            workspaceId,
            kind: "MEETING",
            ...(await templateWhere(actor)),
          },
          select: { id: true, name: true },
        }),
  ]);
  return {
    guest,
    meetings,
    tasks,
    availability,
    shifts,
    cycles,
    subscriptions,
    vault,
    maintenance,
    entries,
    people,
    teams,
    projects,
    templates,
  };
}
