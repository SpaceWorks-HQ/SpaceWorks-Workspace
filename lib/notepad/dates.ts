/**
 * Calendar helpers for the personal to-do list. Due dates are plain calendar
 * days ("YYYY-MM-DD") in the workspace time zone, so "today" never shifts
 * with the server's clock.
 */

export type TodoBucket = "overdue" | "today" | "upcoming" | "someday" | "done";

export const TODO_BUCKETS: ReadonlyArray<{ key: TodoBucket; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "someday", label: "Someday" },
  { key: "done", label: "Done" },
];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Today's calendar day in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar day. */
export function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export function todoBucket(todo: { done: boolean; dueOn: string | null }, today: string): TodoBucket {
  if (todo.done) return "done";
  if (!todo.dueOn) return "someday";
  if (todo.dueOn < today) return "overdue";
  if (todo.dueOn === today) return "today";
  return "upcoming";
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_ALIASES: Record<string, number> = Object.fromEntries(
  WEEKDAYS.flatMap((short, index) => {
    const long = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][index];
    return [[short, index], [long, index]];
  }),
);

/**
 * Quick add: a trailing date word sets the due day and is removed from the
 * text. "Order solder tomorrow" → due tomorrow; "Call venue fri" → the next
 * Friday (a week out when today is Friday); "Renew domain 2026-11-02".
 * A leading or trailing "!" stars the to-do. Anything else stays text.
 */
export function parseQuickTodo(input: string, today: string): { text: string; dueOn: string | null; starred: boolean } {
  let text = input.replace(/\s+/g, " ").trim();
  let starred = false;
  if (text.startsWith("!")) {
    starred = true;
    text = text.slice(1).trim();
  }
  if (text.endsWith("!")) {
    starred = true;
    text = text.slice(0, -1).trim();
  }
  let dueOn: string | null = null;
  const nextWeek = text.match(/^(.*\S)\s+next\s+week$/i);
  if (nextWeek) return { text: nextWeek[1].trim(), dueOn: addDays(today, 7 - ((weekday(today) + 6) % 7)), starred };
  const match = text.match(/^(.*\S)\s+(\S+)$/);
  if (match) {
    const word = match[2].toLowerCase();
    let day: string | null = null;
    if (word === "today" || word === "tonight") day = today;
    else if (word === "tomorrow" || word === "tmrw") day = addDays(today, 1);
    else if (Object.hasOwn(WEEKDAY_ALIASES, word)) {
      const target = WEEKDAY_ALIASES[word];
      const ahead = (target - weekday(today) + 7) % 7 || 7;
      day = addDays(today, ahead);
    } else if (isDay(word)) day = word;
    if (day) {
      dueOn = day;
      text = match[1].trim();
    }
  }
  return { text, dueOn, starred };
}

/** A short, friendly label for a due day relative to today. */
export function dueLabel(dueOn: string, today: string): string {
  if (dueOn === today) return "Today";
  if (dueOn === addDays(today, 1)) return "Tomorrow";
  if (dueOn === addDays(today, -1)) return "Yesterday";
  const date = new Date(`${dueOn}T00:00:00Z`);
  const sameYear = dueOn.slice(0, 4) === today.slice(0, 4);
  const diff = Math.round((date.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  if (diff > 0 && diff < 7) return date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** Position between two neighbours; callers renumber when the gap gets tiny. */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return (after as number) - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}
