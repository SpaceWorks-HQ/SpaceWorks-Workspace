import Link from "next/link";
import type { AttendanceStatus, CommunityEventKind } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Card, Chip, DateBlock, EmptyState, type ChipTone } from "@/components/ui/display";
import { formatDateBlock, formatDayLong, formatTime, formatTimeRange } from "@/lib/format/datetime";
import { attendanceLabel } from "@/lib/community/rsvp";
import { effectiveEnd } from "@/lib/community/schedule";
import { EVENT_KIND_LABELS } from "@/lib/community/validation";

/** Server-rendered month, week and list views of community events (days in the workspace zone). */

export type CalendarEvent = {
  id: string;
  title: string;
  kind: CommunityEventKind;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  capacity: number | null;
  cancelledAt: Date | null;
  going: number;
  myStatus: AttendanceStatus | null;
};

export const KIND_TONES: Record<CommunityEventKind, ChipTone> = { BUILD_NIGHT: "accent", MEETUP: "info", WORKSHOP: "success", OTHER: "neutral" };

const STATUS_TONES: Record<AttendanceStatus, ChipTone> = { GOING: "success", MAYBE: "warning", NOT_GOING: "outline", WAITLIST: "info" };

export function MyStatusChip({ status }: { status: AttendanceStatus | null }) {
  if (!status) return null;
  return <Chip tone={STATUS_TONES[status]} size="sm">{status === "WAITLIST" ? "On the waitlist" : attendanceLabel(status)}</Chip>;
}

function dayNumber(key: string) {
  return String(Number(key.slice(8, 10)));
}

function dayLabel(key: string, now: Date) {
  // Noon UTC on that date keeps the label on the same calendar day in any zone.
  return formatDayLong(new Date(`${key}T12:00:00Z`), "UTC", now);
}

function EventLine({ event, base, timeZone }: { event: CalendarEvent; base: string; timeZone: string }) {
  return (
    <Link
      href={`${base}/${event.id}`}
      className={cn(
        "block truncate rounded-sm px-1.5 py-0.5 text-caption text-ink hover:bg-accent-soft",
        event.cancelledAt && "text-ink-muted line-through",
      )}
    >
      <span className="tabular-nums text-ink-secondary">{formatTime(event.startsAt, timeZone)}</span> {event.title}
      {event.cancelledAt ? <span className="sr-only"> (cancelled)</span> : null}
    </Link>
  );
}

export function MonthView({
  weeks,
  monthKey,
  todayKey,
  byDay,
  base,
  timeZone,
  now,
}: {
  weeks: string[][];
  monthKey: string;
  todayKey: string;
  byDay: Map<string, CalendarEvent[]>;
  base: string;
  timeZone: string;
  now: Date;
}) {
  const month = monthKey.slice(0, 7);
  const daysWithEvents = weeks.flat().filter((key) => key.startsWith(month) && (byDay.get(key)?.length ?? 0) > 0);
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-line bg-panel sm:block">
        <div className="grid grid-cols-7 border-b border-line bg-surface" aria-hidden>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
            <span key={name} className="px-2 py-2 text-caption font-semibold text-accent-text">{name}</span>
          ))}
        </div>
        <ol className="grid grid-cols-7">
          {weeks.flat().map((key) => {
            const events = byDay.get(key) ?? [];
            const inMonth = key.startsWith(month);
            const isToday = key === todayKey;
            return (
              <li key={key} className={cn("min-h-28 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-surface")}>
                <h3 className="mb-1 flex items-center justify-between px-1">
                  <span className="sr-only">{dayLabel(key, now)}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded-full text-caption tabular-nums",
                      isToday ? "bg-primary font-semibold text-on-primary" : inMonth ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {dayNumber(key)}
                  </span>
                  {isToday ? <span className="sr-only">Today</span> : null}
                </h3>
                {events.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {events.slice(0, 3).map((event) => (
                      <li key={event.id}>
                        <EventLine event={event} base={base} timeZone={timeZone} />
                      </li>
                    ))}
                    {events.length > 3 ? (
                      <li>
                        <Link href={`${base}?view=week&date=${key}`} className="block px-1.5 text-caption font-semibold text-accent-text hover:underline">
                          {events.length - 3} more
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="sm:hidden">
        {daysWithEvents.length === 0 ? (
          <EmptyState title="Nothing planned this month.">Put the next build night on the calendar.</EmptyState>
        ) : (
          <AgendaDays days={daysWithEvents} byDay={byDay} base={base} timeZone={timeZone} now={now} todayKey={todayKey} />
        )}
      </div>
    </>
  );
}

export function WeekView({ days, todayKey, byDay, base, timeZone, now }: { days: string[]; todayKey: string; byDay: Map<string, CalendarEvent[]>; base: string; timeZone: string; now: Date }) {
  return (
    <ol className="grid gap-3 md:grid-cols-7 md:gap-0 md:overflow-hidden md:rounded-xl md:border md:border-line md:bg-panel">
      {days.map((key) => {
        const events = byDay.get(key) ?? [];
        const isToday = key === todayKey;
        return (
          <li key={key} className="rounded-xl border border-line bg-panel p-3 md:min-h-64 md:rounded-none md:border-0 md:border-r md:p-2 md:last:border-r-0">
            <h3 className={cn("mb-2 text-label", isToday ? "text-accent-text" : "text-ink")}>
              {dayLabel(key, now)}
              {isToday ? <span className="ml-1.5 font-normal text-ink-muted">· Today</span> : null}
            </h3>
            {events.length === 0 ? (
              <p className="text-caption text-ink-muted">Nothing planned.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {events.map((event) => (
                  <li key={event.id}>
                    <Link href={`${base}/${event.id}`} className="block rounded-md border border-line p-2 hover:bg-subtle">
                      <span className={cn("block text-label text-ink", event.cancelledAt && "text-ink-muted line-through")}>{event.title}</span>
                      <span className="block text-caption tabular-nums text-ink-muted">{formatTimeRange(event.startsAt, effectiveEnd(event.startsAt, event.endsAt), timeZone, { withZone: false })}</span>
                      {event.cancelledAt ? <Chip tone="danger" size="sm" className="mt-1">Cancelled</Chip> : <MyStatusChip status={event.myStatus} />}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function EventCard({ event, base, timeZone }: { event: CalendarEvent; base: string; timeZone: string }) {
  const block = formatDateBlock(event.startsAt, timeZone);
  const full = event.capacity !== null && event.going >= event.capacity;
  return (
    <Link href={`${base}/${event.id}`} className="flex gap-4 rounded-xl border border-line bg-panel p-4 transition-colors duration-[120ms] hover:bg-subtle">
      <DateBlock month={block.month} day={block.day} tone={event.cancelledAt ? "draft" : "accent"} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <Chip tone={KIND_TONES[event.kind]} size="sm">{EVENT_KIND_LABELS[event.kind]}</Chip>
          {event.cancelledAt ? <Chip tone="danger" size="sm">Cancelled</Chip> : <MyStatusChip status={event.myStatus} />}
        </span>
        <span className={cn("mt-1.5 block text-title text-ink", event.cancelledAt && "text-ink-muted line-through")}>{event.title}</span>
        <span className="mt-0.5 block text-body-ui tabular-nums text-ink-secondary">
          {formatTimeRange(event.startsAt, effectiveEnd(event.startsAt, event.endsAt), timeZone)}
          {event.location ? ` · ${event.location}` : ""}
        </span>
        {event.cancelledAt ? null : (
          <span className="mt-1 block text-caption tabular-nums text-ink-muted">
            {event.capacity !== null ? `${event.going} of ${event.capacity} going${full ? " · full, waitlist open" : ""}` : `${event.going} going`}
          </span>
        )}
      </span>
    </Link>
  );
}

function AgendaDays({ days, byDay, base, timeZone, now, todayKey }: { days: string[]; byDay: Map<string, CalendarEvent[]>; base: string; timeZone: string; now: Date; todayKey: string }) {
  return (
    <ol className="flex flex-col gap-6">
      {days.map((key) => (
        <li key={key} className="flex flex-col gap-2">
          <h3 className="text-label text-ink-secondary">
            {dayLabel(key, now)}
            {key === todayKey ? " · Today" : ""}
          </h3>
          <ul className="flex flex-col gap-2">
            {(byDay.get(key) ?? []).map((event) => (
              <li key={event.id}>
                <EventCard event={event} base={base} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function ListView({ byDay, base, timeZone, now, todayKey, emptyAction }: { byDay: Map<string, CalendarEvent[]>; base: string; timeZone: string; now: Date; todayKey: string; emptyAction?: React.ReactNode }) {
  const days = [...byDay.keys()].filter((key) => key >= todayKey).sort();
  if (days.length === 0) {
    return (
      <EmptyState title="No events planned." action={emptyAction}>
        Put the next build night on the calendar.
      </EmptyState>
    );
  }
  return (
    <Card padding="none" className="border-0 bg-transparent">
      <AgendaDays days={days} byDay={byDay} base={base} timeZone={timeZone} now={now} todayKey={todayKey} />
    </Card>
  );
}
