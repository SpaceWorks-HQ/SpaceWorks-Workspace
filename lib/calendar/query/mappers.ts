import "server-only";

import type { Actor } from "@/lib/meetings/core";
import { nextOccurrence } from "@/lib/monitor/maintenance";
import type { Layer } from "../algorithms";
import type { CalendarItem } from "../query";
import { taskUrl } from "@/lib/tasks/links";
import { managesMeeting } from "@/lib/meetings/service";
import type { loadCalendarRecords } from "./records";


export function mapCalendar(actor: Actor, start: Date, end: Date, records: Awaited<ReturnType<typeof loadCalendarRecords>>) {
  const {
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
  } = records;
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
