import { safeTimeZone, zonedInputToIso } from "@/lib/timeZone";

/**
 * Civil-date helpers in an IANA time zone (pure, client-safe). A "day
 * number" is days since 1970-01-01 of the local calendar date, so date
 * arithmetic never trips over DST or UTC offsets.
 */

export const DAY_MS = 86_400_000;

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; /** 0 = Monday … 6 = Sunday */ weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  const zone = safeTimeZone(timeZone);
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, value);
  }
  return value;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const dayNumber = Date.UTC(year, month - 1, day) / DAY_MS;
  return { year, month, day, hour: get("hour") % 24, minute: get("minute"), weekday: weekdayOfDayNumber(dayNumber) };
}

/** 0 = Monday … 6 = Sunday. 1970-01-01 was a Thursday (3). */
export function weekdayOfDayNumber(dayNumber: number): number {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

export function dayNumberOf(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function localDayNumber(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  return dayNumberOf(parts.year, parts.month, parts.day);
}

export function civilOfDayNumber(dayNumber: number): { year: number; month: number; day: number } {
  const date = new Date(dayNumber * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** "2026-10-19" for a day number. */
export function isoDateOfDayNumber(dayNumber: number): string {
  const { year, month, day } = civilOfDayNumber(dayNumber);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * The instant of a local wall-clock time. Times that do not exist (a DST
 * gap) move forward an hour, so a schedule never silently skips a day.
 */
export function localToInstant(dayNumber: number, hour: number, minute: number, timeZone: string): Date {
  const zone = safeTimeZone(timeZone);
  for (let shift = 0; shift < 3; shift += 1) {
    const iso = zonedInputToIso(`${isoDateOfDayNumber(dayNumber)}T${pad((hour + shift) % 24)}:${pad(minute)}`, zone);
    if (iso) return new Date(iso);
  }
  // Fallback: treat the wall time as UTC (never reached for real zones).
  return new Date(dayNumber * DAY_MS + (hour * 60 + minute) * 60_000);
}

/** Start of the local day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  return localToInstant(localDayNumber(date, timeZone), 0, 0, timeZone);
}

/** "2026-10-19" (local) for an <input type="date">. */
export function toDateInputValue(date: Date | null | undefined, timeZone: string): string {
  if (!date) return "";
  return isoDateOfDayNumber(localDayNumber(date, timeZone));
}

/** Parse "YYYY-MM-DD" into the start of that local day, or null. */
export function fromDateInputValue(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return localToInstant(dayNumberOf(year, month, day), 0, 0, timeZone);
}
