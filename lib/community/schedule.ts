import { safeTimeZone } from "@/lib/timeZone";

/**
 * Time rules for the community area (pure). Instants are stored in UTC;
 * calendar days are "YYYY-MM-DD" keys in the workspace time zone, so a build
 * night at 11 PM IST lands on the right square even though it is the
 * previous day in UTC.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Events without an end time are shown as two hours long. */
export const DEFAULT_EVENT_DURATION_MS = 2 * HOUR;

export function effectiveEnd(startsAt: Date, endsAt: Date | null): Date {
  return endsAt && endsAt.getTime() > startsAt.getTime() ? endsAt : new Date(startsAt.getTime() + DEFAULT_EVENT_DURATION_MS);
}

/* ───────────── Announcements ───────────── */

export type AnnouncementStatus = "draft" | "scheduled" | "published";

export function announcementStatus(publishedAt: Date | null, now: Date): AnnouncementStatus {
  if (!publishedAt) return "draft";
  return publishedAt.getTime() > now.getTime() ? "scheduled" : "published";
}

/** One `announcement.published` per announcement and publish time (the scheduler's idempotency key). */
export function announcementDedupeKey(announcementId: string, publishedAt: Date) {
  return `announcement.published:${announcementId}:${publishedAt.toISOString()}`;
}

/** How far back the scheduler looks for announcements whose time has come (covers downtime). */
export const ANNOUNCEMENT_CATCH_UP_MS = DAY;

/* ───────────── Event reminders ───────────── */

export type ReminderKind = "24h" | "1h";

export const REMINDERS: ReadonlyArray<{ kind: ReminderKind; beforeMs: number; label: string }> = [
  { kind: "24h", beforeMs: DAY, label: "tomorrow" },
  { kind: "1h", beforeMs: HOUR, label: "in an hour" },
];

/**
 * Reminders that are due for an event at `now`. Each one has a window: the
 * day-before reminder runs from 24 h until 1 h before the start (after that
 * the 1 h reminder takes over), the hour-before one until the start. A
 * reminder is skipped when the event was created after it became due:
 * people just heard about it through `event.created`.
 */
export function dueReminders(event: { startsAt: Date; createdAt: Date; cancelledAt: Date | null }, now: Date): ReminderKind[] {
  if (event.cancelledAt) return [];
  const start = event.startsAt.getTime();
  const at = now.getTime();
  const due: ReminderKind[] = [];
  REMINDERS.forEach((reminder, index) => {
    const dueAt = start - reminder.beforeMs;
    const next = REMINDERS[index + 1];
    const closesAt = next ? start - next.beforeMs : start;
    if (at >= dueAt && at < closesAt && event.createdAt.getTime() <= dueAt) due.push(reminder.kind);
  });
  return due;
}

export function reminderDedupeKey(eventId: string, kind: ReminderKind, startsAt: Date) {
  return `event.reminder:${eventId}:${kind}:${startsAt.toISOString()}`;
}

/* ───────────── Calendar days in the workspace time zone ───────────── */

export type CalendarView = "month" | "week" | "list";
export const CALENDAR_VIEWS: readonly CalendarView[] = ["month", "week", "list"] as const;

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === "string" && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A valid "YYYY-MM-DD" key, or null. */
export function parseDayKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(DAY_KEY);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? value : null;
}

/** The calendar day of `instant` in `timeZone`. */
export function dayKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function keyToUtcDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

export function addDays(key: string, days: number): string {
  return new Date(keyToUtcDate(key).getTime() + days * DAY).toISOString().slice(0, 10);
}

export function addMonths(key: string, months: number): string {
  const date = keyToUtcDate(key);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  return target.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday (weeks start on Monday, en-GB). */
export function weekdayIndex(key: string): number {
  return (keyToUtcDate(key).getUTCDay() + 6) % 7;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The first instant of the day `key` in `timeZone` (handles DST changes). */
export function startOfDay(key: string, timeZone: string): Date {
  const guess = keyToUtcDate(key).getTime();
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  // A second pass settles days whose offset differs from the guess (DST).
  instant = guess - zoneOffsetMs(new Date(instant), timeZone);
  // Some zones skip midnight on DST days; the day then starts at the first instant whose key matches.
  if (dayKey(new Date(instant), timeZone) !== key) instant += HOUR;
  return new Date(instant);
}

/** Weeks (Monday first) covering the month that contains `key`, as day keys. */
export function monthGrid(key: string): string[][] {
  const first = `${key.slice(0, 7)}-01`;
  const nextMonth = addMonths(first, 1);
  let cursor = addDays(first, -weekdayIndex(first));
  const weeks: string[][] = [];
  while (cursor < nextMonth) {
    const week = Array.from({ length: 7 }, (_, index) => addDays(cursor, index));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** The seven day keys of the Monday-first week containing `key`. */
export function weekDays(key: string): string[] {
  const monday = addDays(key, -weekdayIndex(key));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** UTC range [start, end) to query for a calendar view anchored on `key`. */
export function viewRange(view: CalendarView, key: string, timeZone: string, now: Date): { start: Date; end: Date } {
  if (view === "month") {
    const weeks = monthGrid(key);
    return { start: startOfDay(weeks[0]![0]!, timeZone), end: startOfDay(addDays(weeks[weeks.length - 1]![6]!, 1), timeZone) };
  }
  if (view === "week") {
    const days = weekDays(key);
    return { start: startOfDay(days[0]!, timeZone), end: startOfDay(addDays(days[6]!, 1), timeZone) };
  }
  // List: from the start of today, 90 days ahead.
  const today = dayKey(now, timeZone);
  return { start: startOfDay(today, timeZone), end: startOfDay(addDays(today, 90), timeZone) };
}

/** Day keys an event covers (multi-day events appear on every day they span). */
export function eventDayKeys(startsAt: Date, endsAt: Date | null, timeZone: string): string[] {
  const first = dayKey(startsAt, timeZone);
  // An event ending exactly at midnight does not spill into the next day.
  const last = dayKey(new Date(effectiveEnd(startsAt, endsAt).getTime() - 1), timeZone);
  const keys = [first];
  let cursor = first;
  while (cursor < last && keys.length < 62) {
    cursor = addDays(cursor, 1);
    keys.push(cursor);
  }
  return keys;
}
