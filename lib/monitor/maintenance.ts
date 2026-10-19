import { safeTimeZone, zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";

/**
 * Maintenance windows (pure). A window is either one-off (`startsAt` →
 * `endsAt`) or recurring: an RRULE subset (FREQ=DAILY|WEEKLY|MONTHLY,
 * BYDAY, BYMONTHDAY, BYHOUR, BYMINUTE, INTERVAL is not supported) in the
 * window's time zone, lasting `durationMin`. For recurring windows
 * `startsAt` / `endsAt` bound the series.
 */

export type WindowLike = {
  startsAt: Date | null;
  endsAt: Date | null;
  rrule: string | null;
  durationMin: number | null;
  timezone: string;
};

export type Recurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  byDay: number[];
  byMonthDay: number[];
  byHour: number;
  byMinute: number;
};

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export function parseRrule(rrule: string | null | undefined): Recurrence | null {
  if (!rrule) return null;
  const parts = new Map<string, string>();
  for (const piece of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = piece.split("=");
    if (!key || !value || !["FREQ", "BYDAY", "BYMONTHDAY", "BYHOUR", "BYMINUTE"].includes(key.trim().toUpperCase()) || parts.has(key.trim().toUpperCase())) return null;
    parts.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null;
  const byDay = (parts.get("BYDAY") ?? "").split(",").filter(Boolean).map((code) => DAY_CODES.indexOf(code));
  if (byDay.some((day) => day < 0)) return null;
  const byMonthDay = (parts.get("BYMONTHDAY") ?? "").split(",").filter(Boolean).map(Number);
  if (byMonthDay.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) return null;
  const byHour = Number(parts.get("BYHOUR") ?? "0");
  const byMinute = Number(parts.get("BYMINUTE") ?? "0");
  if (!Number.isInteger(byHour) || byHour < 0 || byHour > 23 || !Number.isInteger(byMinute) || byMinute < 0 || byMinute > 59) return null;
  if (freq === "WEEKLY" && byDay.length === 0) return null;
  if (freq === "MONTHLY" && byMonthDay.length === 0) return null;
  return { freq, byDay, byMonthDay, byHour, byMinute };
}

export function buildRrule(input: { freq: Recurrence["freq"]; days?: string[]; monthDays?: number[]; hour: number; minute: number }): string {
  const parts = [`FREQ=${input.freq}`];
  if (input.freq === "WEEKLY") parts.push(`BYDAY=${(input.days ?? []).join(",")}`);
  if (input.freq === "MONTHLY") parts.push(`BYMONTHDAY=${(input.monthDays ?? []).join(",")}`);
  parts.push(`BYHOUR=${input.hour}`, `BYMINUTE=${input.minute}`);
  return parts.join(";");
}

/** Plain-language reading of a recurrence ("Every Sunday at 02:00"). */
export function describeRecurrence(rec: Recurrence, durationMin: number): string {
  const time = `${String(rec.byHour).padStart(2, "0")}:${String(rec.byMinute).padStart(2, "0")}`;
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const length = durationMin % 60 === 0 ? `${durationMin / 60} h` : `${durationMin} min`;
  if (rec.freq === "DAILY") return `Every day at ${time} for ${length}`;
  if (rec.freq === "WEEKLY") return `Every ${rec.byDay.map((day) => names[day]).join(", ")} at ${time} for ${length}`;
  return `Monthly on day ${rec.byMonthDay.join(", ")} at ${time} for ${length}`;
}

/** Local calendar date (y, m, d, weekday) of `at` in `timeZone`. */
function localDate(at: Date, timeZone: string) {
  const value = zonedDatetimeLocalValue(at, timeZone);
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday };
}

function occurrenceStart(y: number, m: number, d: number, rec: Recurrence, timeZone: string): Date | null {
  const value = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(rec.byHour).padStart(2, "0")}:${String(rec.byMinute).padStart(2, "0")}`;
  const iso = zonedInputToIso(value, timeZone);
  return iso ? new Date(iso) : null;
}

function dayMatches(rec: Recurrence, date: { d: number; weekday: number }) {
  if (rec.freq === "DAILY") return true;
  if (rec.freq === "WEEKLY") return rec.byDay.includes(date.weekday);
  return rec.byMonthDay.includes(date.d);
}

/** Occurrence starts whose local day lies in [from - 1 day, to + 1 day]. */
function occurrencesBetween(window: WindowLike, rec: Recurrence, from: Date, to: Date): Date[] {
  const timeZone = safeTimeZone(window.timezone);
  const starts: Date[] = [];
  for (let t = from.getTime() - DAY_MS; t <= to.getTime() + DAY_MS; t += DAY_MS) {
    const date = localDate(new Date(t), timeZone);
    if (!dayMatches(rec, date)) continue;
    const start = occurrenceStart(date.y, date.m, date.d, rec, timeZone);
    if (!start) continue;
    if (window.startsAt && start < window.startsAt) continue;
    if (window.endsAt && start > window.endsAt) continue;
    if (!starts.some((existing) => existing.getTime() === start.getTime())) starts.push(start);
  }
  return starts.sort((a, b) => a.getTime() - b.getTime());
}

export type Occurrence = { start: Date; end: Date };

/** The occurrence that covers `at`, if any. */
export function activeOccurrence(window: WindowLike, at: Date): Occurrence | null {
  const rec = parseRrule(window.rrule);
  if (!rec) {
    if (window.startsAt && window.endsAt && window.startsAt <= at && at < window.endsAt) return { start: window.startsAt, end: window.endsAt };
    return null;
  }
  const duration = Math.max(1, window.durationMin ?? 60) * MINUTE_MS;
  const starts = occurrencesBetween(window, rec, new Date(at.getTime() - duration), at);
  for (const start of starts.reverse()) {
    if (start <= at && at.getTime() < start.getTime() + duration) return { start, end: new Date(start.getTime() + duration) };
  }
  return null;
}

export function isWindowActive(window: WindowLike, at: Date): boolean {
  return activeOccurrence(window, at) !== null;
}

/** The next occurrence starting after `after` (within `horizonDays`). */
export function nextOccurrence(window: WindowLike, after: Date, horizonDays = 35): Occurrence | null {
  const rec = parseRrule(window.rrule);
  if (!rec) {
    if (window.startsAt && window.endsAt && window.startsAt > after) return { start: window.startsAt, end: window.endsAt };
    return null;
  }
  const duration = Math.max(1, window.durationMin ?? 60) * MINUTE_MS;
  const starts = occurrencesBetween(window, rec, after, new Date(after.getTime() + horizonDays * DAY_MS));
  const start = starts.find((candidate) => candidate > after);
  return start ? { start, end: new Date(start.getTime() + duration) } : null;
}

/** Most recent occurrence that ended in (since, at]. Used for maintenance.ended. */
export function recentlyEndedOccurrence(window: WindowLike, since: Date, at: Date): Occurrence | null {
  const rec = parseRrule(window.rrule);
  if (!rec) {
    if (window.startsAt && window.endsAt && window.endsAt > since && window.endsAt <= at) return { start: window.startsAt, end: window.endsAt };
    return null;
  }
  const duration = Math.max(1, window.durationMin ?? 60) * MINUTE_MS;
  const starts = occurrencesBetween(window, rec, new Date(since.getTime() - duration), at);
  for (const start of starts.reverse()) {
    const end = new Date(start.getTime() + duration);
    if (end > since && end <= at) return { start, end };
  }
  return null;
}
