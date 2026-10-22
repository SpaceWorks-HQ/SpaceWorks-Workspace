import { requireWorkspace } from "@/lib/permissions";
import { loadCalendar } from "@/lib/calendar/query";
import { CalendarScreen } from "@/components/calendar/CalendarScreen";
import {
  isValidTimeZone,
  zonedDatetimeLocalValue,
  zonedInputToIso,
} from "@/lib/timeZone";
import { prisma } from "@/lib/db";
import { visibleTaskWhere } from "@/lib/tasks/access";
import { googleBusy, memberGoogle } from "@/lib/calendar/google";

export default async function CalendarPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/calendar">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const q = await searchParams;
  const view =
    typeof q.view === "string" &&
    ["day", "week", "month", "agenda"].includes(q.view)
      ? q.view
      : "month";
  const zone =
    typeof q.zone === "string" && isValidTimeZone(q.zone)
      ? q.zone
      : actor.workspace.timezone;
  const date =
    typeof q.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(q.date) &&
    zonedInputToIso(`${q.date}T12:00`, zone)
      ? q.date
      : zonedDatetimeLocalValue(new Date(), zone).slice(0, 10);
  const anchor = new Date(`${date}T12:00Z`),
    first = new Date(anchor);
  if (view === "month") first.setUTCDate(1);
  if (view === "month" || view === "week")
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const count =
    view === "month" ? 42 : view === "week" ? 7 : view === "day" ? 1 : 30;
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + count);
  const start = new Date(
    zonedInputToIso(`${first.toISOString().slice(0, 10)}T00:00`, zone) ??
      first.toISOString(),
  );
  const end = new Date(
    zonedInputToIso(`${last.toISOString().slice(0, 10)}T00:00`, zone) ??
      last.toISOString(),
  );
  const week = new Date(
    `${zonedDatetimeLocalValue(new Date(), actor.workspace.timezone).slice(0, 10)}T12:00Z`,
  );
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const weekStart = new Date(
    zonedInputToIso(
      `${week.toISOString().slice(0, 10)}T00:00`,
      actor.workspace.timezone,
    )!,
  );
  const nextWeek = new Date(week);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const weekEnd = new Date(
    zonedInputToIso(
      `${nextWeek.toISOString().slice(0, 10)}T00:00`,
      actor.workspace.timezone,
    )!,
  );
  const [data, assigned, google, profile] = await Promise.all([
    loadCalendar(actor, start, end),
    prisma.task.findMany({
      where: {
        AND: [
          await visibleTaskWhere(actor),
          {
            archivedAt: null,
            completedAt: null,
            dueAt: { gte: weekStart, lt: weekEnd },
            assignees: { some: { userId: actor.user.id } },
            OR: [
              { projectId: null },
              {
                project: {
                  workspaceId: actor.workspace.id,
                  status: { not: "ARCHIVED" },
                },
              },
            ],
          },
        ],
      },
      select: { id: true, title: true, number: true, dueAt: true },
      orderBy: { dueAt: "asc" },
      take: 100,
    }),
    actor.membership.role === "GUEST"
      ? null
      : memberGoogle(actor.workspace.id, actor.user.id),
    prisma.user.findUnique({
      where: { id: actor.user.id },
      select: { timezone: true },
    }),
  ]);
  let googleError = false;
  if (google) {
    try {
      const blocks = await googleBusy(
        actor.workspace.id,
        actor.user.id,
        start,
        end,
      );
      data.items.push(
        ...blocks.map((b, i) => ({
          id: `google:${i}`,
          sourceId: String(i),
          layer: "google" as const,
          title: "Busy",
          start: b.start,
          end: b.end,
          url: `/w/${workspaceSlug}/calendar`,
          people: [actor.user.id],
          teamId: null,
          projectId: null,
          mine: true,
        })),
      );
    } catch {
      googleError = true;
    }
  }
  return (
    <CalendarScreen
      data={data}
      assigned={assigned.map((t) => ({ ...t, dueAt: t.dueAt!.toISOString() }))}
      slug={workspaceSlug}
      viewerId={actor.user.id}
      role={actor.membership.role}
      workspaceZone={actor.workspace.timezone}
      viewerZone={profile?.timezone ?? actor.workspace.timezone}
      zone={zone}
      date={date}
      view={view}
      firstDay={first.toISOString().slice(0, 10)}
      dayCount={count}
      googleConnected={!!google}
      googleError={googleError}
    />
  );
}
