/**
 * Quiet hours (pure). A window like { start: "22:00", end: "07:00",
 * tz: "Asia/Kolkata", days: [1, 2, 3, 4, 5] } holds non-critical deliveries
 * until it ends. `days` are ISO weekdays (1 = Monday … 7 = Sunday) on which
 * the window *starts*; omitted or empty means every day. A window with the
 * same start and end is treated as off.
 */
export type QuietHours = { start: string; end: string; tz: string; days?: number[] };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Validate a stored JSON value; returns null when absent or malformed. */
export function parseQuietHours(value: unknown): QuietHours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.start !== "string" || typeof raw.end !== "string" || typeof raw.tz !== "string") return null;
  if (!TIME.test(raw.start) || !TIME.test(raw.end) || !isTimeZone(raw.tz)) return null;
  const days = Array.isArray(raw.days) ? raw.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : undefined;
  return { start: raw.start, end: raw.end, tz: raw.tz, ...(days && days.length > 0 ? { days } : {}) };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Local weekday (1–7), minute of day and second for `at` in `tz`. */
function localClock(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return { weekday: WEEKDAYS[get("weekday")] ?? 1, minute: Number(get("hour")) * 60 + Number(get("minute")), second: Number(get("second")) };
}

/**
 * If `at` falls inside the quiet window, the instant the window ends;
 * otherwise null.
 */
export function quietHoursEnd(quiet: QuietHours, at: Date): Date | null {
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return null;
  const { weekday, minute, second } = localClock(at, quiet.tz);
  const appliesOn = (day: number) => !quiet.days || quiet.days.length === 0 || quiet.days.includes(day);

  let inside = false;
  if (start < end) {
    inside = minute >= start && minute < end && appliesOn(weekday);
  } else if (minute >= start) {
    inside = appliesOn(weekday);
  } else if (minute < end) {
    // After midnight: the window started yesterday.
    inside = appliesOn(weekday === 1 ? 7 : weekday - 1);
  }
  if (!inside) return null;
  const minutesLeft = (end - minute + 1440) % 1440;
  return new Date(at.getTime() + minutesLeft * 60_000 - second * 1000 - at.getMilliseconds());
}

/**
 * When a delivery may go out: `at` itself, or the end of a quiet window /
 * snooze. Critical events go out immediately when `criticalBypasses` is on.
 */
export function deliveryTime(input: {
  at: Date;
  severity: "info" | "warning" | "critical";
  quietHours?: QuietHours | null;
  criticalBypasses?: boolean;
  snoozedUntil?: Date | null;
}): Date {
  const { at, severity } = input;
  if (severity === "critical" && input.criticalBypasses !== false) return at;
  let when = at;
  if (input.snoozedUntil && input.snoozedUntil > when) when = input.snoozedUntil;
  if (input.quietHours) {
    const end = quietHoursEnd(input.quietHours, when);
    if (end) when = end;
  }
  return when;
}
