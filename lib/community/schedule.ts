import { safeTimeZone } from "@/lib/timeZone";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Internal items without an end time last two hours. */
export const DEFAULT_DURATION_MS = 2 * HOUR;

export function effectiveEnd(startsAt: Date, endsAt: Date | null): Date {
  return endsAt && endsAt.getTime() > startsAt.getTime() ? endsAt : new Date(startsAt.getTime() + DEFAULT_DURATION_MS);
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
