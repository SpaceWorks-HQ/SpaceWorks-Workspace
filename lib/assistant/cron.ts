import { CronExpressionParser } from "cron-parser";
import { isValidTimeZone } from "@/lib/timeZone";

/**
 * Scheduled-job timing (pure, unit-tested). Jobs use five-field cron
 * expressions (minute hour day-of-month month day-of-week) evaluated in the
 * job's IANA time zone, so "0 8 * * *" in Asia/Kolkata runs at 08:00 IST.
 */

export function validateCron(expression: string, timeZone: string): { ok: true } | { ok: false; error: string } {
  const trimmed = expression.trim();
  if (trimmed.split(/\s+/).length !== 5) return { ok: false, error: "Use five fields: minute hour day month weekday, e.g. 0 8 * * 1-5." };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Choose a valid time zone." };
  try {
    CronExpressionParser.parse(trimmed, { tz: timeZone, currentDate: new Date() }).next();
    return { ok: true };
  } catch {
    return { ok: false, error: "That schedule isn't a valid cron expression." };
  }
}

/** The first run strictly after `after`. */
export function nextRunAt(expression: string, timeZone: string, after: Date): Date {
  return CronExpressionParser.parse(expression.trim(), { tz: timeZone, currentDate: after }).next().toDate();
}

/** The next `count` runs after `after` (for the form preview). */
export function upcomingRuns(expression: string, timeZone: string, after: Date, count = 3): Date[] {
  const parsed = CronExpressionParser.parse(expression.trim(), { tz: timeZone, currentDate: after });
  return Array.from({ length: count }, () => parsed.next().toDate());
}

/** Rough cadence for the `digest.ready` payload. */
export function digestFrequency(expression: string): "hourly" | "daily" | "weekly" | "custom" {
  const [minute, hour, dom, month, dow] = expression.trim().split(/\s+/);
  const fixed = (field: string | undefined) => Boolean(field && /^\d+$/.test(field));
  if (fixed(minute) && hour === "*" && dom === "*" && month === "*" && dow === "*") return "hourly";
  if (fixed(minute) && fixed(hour) && dom === "*" && month === "*" && dow === "*") return "daily";
  if (fixed(minute) && fixed(hour) && dom === "*" && month === "*" && fixed(dow)) return "weekly";
  return "custom";
}

export const JOB_TEMPLATES = [
  {
    key: "morning-digest",
    name: "Morning digest",
    cron: "0 8 * * *",
    prompt: [
      "Write this morning's digest for the community.",
      "Include: tasks due today or overdue (with owners), anything that moved to done yesterday, today's and tomorrow's events or build nights, new announcements, and open incidents if there are any.",
      "Skip empty sections. Use short bullet lists with task references and links. End with one line of encouragement for the crew.",
    ].join(" "),
  },
  {
    key: "weekly-review",
    name: "Weekly review",
    cron: "0 18 * * 5",
    prompt: "Write the weekly review for the community: what shipped this week, what is stuck or overdue (with owners), what is coming up next week, and people who helped others. Under 250 words.",
  },
] as const;
