import "server-only";
import { templateWhere } from "@/lib/templates/service";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/meetings/core";
import { visibleTaskWhere, visibleProjectWhere } from "@/lib/tasks/access";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import {
  assertCalendarReader,
  calendarMeetingWhere,
  entryWhere,
} from "./access";
import { nextOccurrence } from "@/lib/monitor/maintenance";
import type { Layer } from "./algorithms";
import { taskUrl } from "@/lib/tasks/links";
import { managesMeeting } from "@/lib/meetings/service";

export type CalendarItem = {
  id: string;
  sourceId: string;
  layer: Layer;
  title: string;
  start: string;
  end: string;
  url: string;
  people: string[];
  teamId: string | null;
  projectId: string | null;
  mine: boolean;
  taskNumber?: number;
  editable?: boolean;
  status?: string;
  avatars?: { name: string; image: string | null }[];
};
export async function loadCalendar(actor: Actor, start: Date, end: Date) {
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
  const items: CalendarItem[] = [];
  const base = `/w/${actor.workspace.slug}`;
  const add = (
    id: string,
    layer: Layer,
    title: string,
    from: Date,
    to: Date | null,
    url: string,
    ids: string[] = [],
    teamId: string | null = null,
    projectId: string | null = null,
    extra: Partial<CalendarItem> = {},
  ) =>
    items.push({
      id: `${layer}:${id}`,
      sourceId: id,
      layer,
      title,
      start: from.toISOString(),
      end: (to ?? new Date(from.getTime() + 1800000)).toISOString(),
      url,
      people: ids,
      teamId,
      projectId,
      mine: ids.includes(actor.user.id),
      ...extra,
    });
  for (const m of meetings)
    add(
      m.id,
      "meeting",
      m.title,
      m.startsAt,
      m.endsAt,
      `${base}/meetings/${m.id}`,
      m.attendees.flatMap((a) => (a.userId ? [a.userId] : [])),
      m.teamId,
      m.projectId,
      { editable: !guest && managesMeeting(actor, m), status: m.status },
    );
  for (const t of tasks)
    add(
      t.id,
      "task",
      t.title,
      t.dueAt!,
      t.dueAt,
      taskUrl(actor.workspace.slug, t.project?.key, t.number),
      t.assignees.map((a) => a.userId),
      t.project?.teamId ?? null,
      t.projectId,
      {
        editable: !guest,
        taskNumber: t.number,
        status: t.completedAt ? "Done" : "Due",
        avatars: t.assignees.map((a) => ({
          name: a.user.name ?? "Member",
          image: a.user.image,
        })),
      },
    );
  for (const a of availability)
    add(
      a.id,
      "availability",
      `${people.find((p) => p.user.id === a.userId)?.user.name ?? "Member"} · ${a.type.toLowerCase().replaceAll("_", " ")}`,
      a.startsAt,
      a.endsAt,
      `${base}/members/${a.userId}`,
      [a.userId],
    );
  for (const s of shifts)
    add(
      s.id,
      "shift",
      s.shiftType.name,
      s.startsAt,
      s.endsAt,
      `${base}/rota`,
      s.assignments.map((a) => a.userId),
      s.shiftType.teamId,
    );
  for (const c of cycles)
    for (const [label, date] of [
      ["starts", c.startsAt],
      ["ends", c.endsAt],
    ] as const)
      if (date >= start && date < end)
        add(
          `${c.id}-${label}`,
          "cycle",
          `${c.name ?? `Cycle ${c.number}`} ${label}`,
          date,
          date,
          `${base}/cycles/${c.id}`,
          [],
          c.teamId,
          c.projectId,
        );
  for (const s of subscriptions)
    add(
      s.id,
      "renewal",
      s.name,
      s.nextRenewalAt!,
      s.nextRenewalAt,
      `${base}/subscriptions`,
      s.ownerId ? [s.ownerId] : [],
      s.teamId,
    );
  for (const v of vault) {
    const date = new Date(
      (v.lastRotatedAt ?? v.createdAt).getTime() +
        v.rotateEveryDays! * 86400000,
    );
    if (date >= start && date < end)
      add(v.id, "rotation", v.title, date, date, `${base}/vault`, [
        actor.user.id,
      ]);
  }
  for (const m of maintenance) {
    const lookback = m.rrule
      ? (m.durationMin ?? 60) * 60000
      : Math.max(
          60000,
          (m.endsAt?.getTime() ?? 0) - (m.startsAt?.getTime() ?? 0),
        );
    let cursor = new Date(start.getTime() - lookback - 1);
    for (let index = 0; index < 100; index++) {
      const occurrence = nextOccurrence(m, cursor, 50);
      if (!occurrence || occurrence.start >= end) break;
      if (occurrence.end > start)
        add(
          `${m.id}-${index}`,
          "maintenance",
          m.title,
          occurrence.start,
          occurrence.end,
          `${base}/services/maintenance`,
        );
      cursor = new Date(occurrence.start.getTime() + 1);
    }
  }
  for (const e of entries)
    add(
      e.id,
      e.kind === "DEADLINE" ? "deadline" : "reminder",
      e.title,
      e.startsAt,
      e.endsAt,
      `${base}/calendar`,
      [e.ownerId],
      e.teamId,
      e.projectId,
      { editable: e.ownerId === actor.user.id },
    );
  return {
    items: items.sort((a, b) => a.start.localeCompare(b.start)),
    meetings: meetings.map((m) => ({
      ...m,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt?.toISOString() ?? null,
      createdAt: undefined,
      updatedAt: undefined,
      reminderSentAt: undefined,
      summaryPublishedAt: undefined,
    })),
    entries: entries.map((e) => ({
      ...e,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      createdAt: undefined,
      updatedAt: undefined,
      reminderSentAt: undefined,
    })),
    people: people.map((p) => p.user),
    teams,
    projects,
    templates,
    truncated: [
      meetings,
      tasks,
      availability,
      shifts,
      cycles,
      subscriptions,
      vault,
      maintenance,
      entries,
    ].some((a) => a.length === 1000),
  };
}
