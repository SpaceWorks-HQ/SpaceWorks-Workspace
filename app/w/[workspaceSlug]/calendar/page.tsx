import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ListView, MonthView, WeekView, type CalendarEvent } from "@/components/community/CalendarViews";
import { LiveRefresh } from "@/components/community/LiveRefresh";
import { Button, buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { formatTimeZoneName } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { safeTimeZone } from "@/lib/timeZone";
import { canCreateEvents } from "@/lib/community/access";
import { listEvents } from "@/lib/community/events";
import { addDays, addMonths, dayKey, eventDayKeys, isCalendarView, monthGrid, parseDayKey, viewRange, weekDays, type CalendarView } from "@/lib/community/schedule";

export const metadata = { title: "Calendar" };

function monthTitle(key: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key.slice(0, 7)}-15T12:00:00Z`));
}

function weekTitle(days: string[]) {
  const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const first = days[0]!;
  const last = days[6]!;
  return `${fmt(first, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

export default async function CalendarPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/calendar">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const query = await searchParams;
  const { workspace } = ctx;
  const tz = safeTimeZone(workspace.timezone);
  const now = new Date();
  const todayKey = dayKey(now, tz);
  const view: CalendarView = isCalendarView(query.view) ? query.view : "month";
  const anchor = parseDayKey(query.date) ?? todayKey;
  const base = `/w/${workspace.slug}/calendar`;

  const range = viewRange(view, anchor, tz, now);
  const events: CalendarEvent[] = await listEvents(ctx, range);
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    for (const key of eventDayKeys(event.startsAt, event.endsAt, tz)) {
      const list = byDay.get(key) ?? [];
      list.push(event);
      byDay.set(key, list);
    }
  }

  const step = (direction: 1 | -1) => (view === "month" ? addMonths(anchor, direction) : addDays(anchor, 7 * direction));
  const href = (nextView: CalendarView, date?: string) => `${base}?view=${nextView}${date ? `&date=${date}` : ""}`;
  const weeks = monthGrid(anchor);
  const days = weekDays(anchor);
  const canCreate = canCreateEvents(ctx.membership);
  const newEvent = canCreate ? (
    <Button asChild variant="primary" startIcon={<Plus />}>
      <Link href={`${base}/new${view !== "list" ? `?date=${anchor}` : ""}`}>New event</Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh slug={workspace.slug} types={["community.event.changed"]} />
      <PageHeader
        title="Calendar"
        description="Build nights, meetups and workshops."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`${base}/subscribe`}>Subscribe</Link>
            </Button>
            {newEvent}
          </>
        }
      />
      <NavTabs
        label="Calendar views"
        items={[
          { href: href("month", anchor), label: "Month", active: view === "month" },
          { href: href("week", anchor), label: "Week", active: view === "week" },
          { href: href("list"), label: "Upcoming", active: view === "list" },
        ]}
      />
      {view === "list" ? (
        <p className="text-body-ui text-ink-muted">The next 90 days. Times in {formatTimeZoneName(now, tz)}.</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3 text-ink" aria-live="polite">{view === "month" ? monthTitle(anchor) : weekTitle(days)}</h2>
          <div className="flex items-center gap-2">
            <span className="mr-1 hidden text-caption text-ink-muted sm:inline">Times in {formatTimeZoneName(now, tz)}</span>
            <Link href={href(view, step(-1))} aria-label={view === "month" ? "Previous month" : "Previous week"} className={buttonClasses({ variant: "secondary", size: "sm", className: "px-2.5" })}>
              <ChevronLeft aria-hidden className="size-[18px]" />
            </Link>
            <Link href={href(view, todayKey)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Today</Link>
            <Link href={href(view, step(1))} aria-label={view === "month" ? "Next month" : "Next week"} className={buttonClasses({ variant: "secondary", size: "sm", className: "px-2.5" })}>
              <ChevronRight aria-hidden className="size-[18px]" />
            </Link>
          </div>
        </div>
      )}
      {view === "month" ? <MonthView weeks={weeks} monthKey={anchor} todayKey={todayKey} byDay={byDay} base={base} timeZone={tz} now={now} /> : null}
      {view === "week" ? <WeekView days={days} todayKey={todayKey} byDay={byDay} base={base} timeZone={tz} now={now} /> : null}
      {view === "list" ? <ListView byDay={byDay} base={base} timeZone={tz} now={now} todayKey={todayKey} emptyAction={newEvent} /> : null}
    </div>
  );
}
