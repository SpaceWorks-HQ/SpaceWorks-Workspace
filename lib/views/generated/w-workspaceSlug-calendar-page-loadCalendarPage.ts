// Generated from app/w/[workspaceSlug]/calendar/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { type CalendarEvent } from "@/components/community/CalendarViews";
import { requireWorkspace } from "@/lib/permissions";
import { safeTimeZone } from "@/lib/timeZone";
import { canCreateEvents } from "@/lib/community/access";
import { listEvents } from "@/lib/community/events";
import { addDays, addMonths, dayKey, eventDayKeys, isCalendarView, monthGrid, parseDayKey, viewRange, weekDays, type CalendarView } from "@/lib/community/schedule";
function monthTitle(key: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key.slice(0, 7)}-15T12:00:00Z`));
}
function weekTitle(days: string[]) {
  const fmt = (key: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
  const first = days[0]!;
  const last = days[6]!;
  return `${fmt(first, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
}
export async function loadCalendarPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/calendar">) {
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
return viewDto({ workspace, tz, now, todayKey, view, anchor, base, byDay, weeks, days, canCreate } as const);
}
