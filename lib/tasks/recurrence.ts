import { civilOfDayNumber, dayNumberOf, daysInMonth, localDayNumber, localParts, localToInstant } from "@/lib/tasks/localDate";

/**
 * Recurring tasks (pure, client-safe): the RFC 5545 RRULE subset the task
 * editor writes, next-occurrence maths in the workspace time zone, plain
 * language descriptions, and assignee rotation.
 *
 * Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL (1–365),
 * BYDAY (weekly: MO…SU), BYMONTHDAY (monthly: 1–31 or -1 for the last day;
 * days past the month's end fall on its last day).
 */

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  freq: Frequency;
  interval: number;
  /** Weekly only. Empty or missing = the anchor's weekday. */
  byDay?: Weekday[];
  /** Monthly only. Missing = the anchor's day of month; -1 = last day. */
  byMonthDay?: number;
};

const WEEKDAY_LABELS: Record<Weekday, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const FREQUENCIES: Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

export function parseRRule(value: string | null | undefined): RecurrenceRule | null {
  if (!value) return null;
  const body = value.trim().replace(/^RRULE:/i, "");
  if (!body || body.length > 200) return null;
  const fields = new Map<string, string>();
  for (const part of body.split(";")) {
    const [key, raw] = part.split("=");
    if (!key || raw === undefined) return null;
    fields.set(key.trim().toUpperCase(), raw.trim().toUpperCase());
  }
  const freq = fields.get("FREQ") as Frequency | undefined;
  if (!freq || !FREQUENCIES.includes(freq)) return null;
  const interval = fields.has("INTERVAL") ? Number(fields.get("INTERVAL")) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return null;
  const rule: RecurrenceRule = { freq, interval };
  if (fields.has("BYDAY")) {
    if (freq !== "WEEKLY") return null;
    const days = fields.get("BYDAY")!.split(",").map((day) => day.trim()).filter(Boolean);
    if (days.length === 0 || days.some((day) => !(WEEKDAYS as readonly string[]).includes(day))) return null;
    rule.byDay = WEEKDAYS.filter((day) => days.includes(day));
  }
  if (fields.has("BYMONTHDAY")) {
    if (freq !== "MONTHLY") return null;
    const day = Number(fields.get("BYMONTHDAY"));
    if (!Number.isInteger(day) || !(day === -1 || (day >= 1 && day <= 31))) return null;
    rule.byMonthDay = day;
  }
  for (const key of fields.keys()) if (!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY"].includes(key)) return null;
  return rule;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === "WEEKLY" && rule.byDay?.length) parts.push(`BYDAY=${WEEKDAYS.filter((day) => rule.byDay!.includes(day)).join(",")}`);
  if (rule.freq === "MONTHLY" && rule.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  return parts.join(";");
}

function ordinal(day: number) {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

/** "Every week on Mon and Thu", "Every 2 months on the 15th", "Every day". */
export function describeRule(rule: RecurrenceRule): string {
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[rule.freq];
  const every = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.freq === "WEEKLY" && rule.byDay?.length) {
    const weekdays = ["MO", "TU", "WE", "TH", "FR"] as const;
    if (rule.interval === 1 && rule.byDay.length === 5 && weekdays.every((day) => rule.byDay!.includes(day))) return "Every weekday";
    const labels = rule.byDay.map((day) => WEEKDAY_LABELS[day]);
    const list = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0];
    return `${every} on ${list}`;
  }
  if (rule.freq === "MONTHLY" && rule.byMonthDay !== undefined) {
    return rule.byMonthDay === -1 ? `${every} on the last day` : `${every} on the ${ordinal(rule.byMonthDay)}`;
  }
  return every;
}

/**
 * The first occurrence strictly after `after`. `anchor` fixes the phase
 * (which week/month counts as "every other") and the local time of day; no
 * occurrence is ever earlier than the anchor's day.
 */
export function nextOccurrence(rule: RecurrenceRule, anchor: Date, after: Date, timeZone: string): Date | null {
  const a = localParts(anchor, timeZone);
  const anchorDay = dayNumberOf(a.year, a.month, a.day);
  const afterDay = localDayNumber(after, timeZone);
  const at = (dayNumber: number) => localToInstant(dayNumber, a.hour, a.minute, timeZone);
  const interval = Math.max(1, Math.trunc(rule.interval));
  const MAX_STEPS = 2000;

  if (rule.freq === "DAILY") {
    let k = Math.max(0, Math.floor((afterDay - anchorDay) / interval) - 1);
    for (let step = 0; step < MAX_STEPS; step += 1, k += 1) {
      const instant = at(anchorDay + k * interval);
      if (instant > after) return instant;
    }
    return null;
  }

  if (rule.freq === "WEEKLY") {
    const days = (rule.byDay?.length ? rule.byDay : [WEEKDAYS[a.weekday]!]).map((day) => WEEKDAYS.indexOf(day)).sort((x, y) => x - y);
    const anchorWeek = anchorDay - a.weekday;
    let w = Math.max(0, Math.floor((afterDay - anchorWeek) / (7 * interval)) - 1);
    for (let step = 0; step < MAX_STEPS; step += 1, w += 1) {
      const weekStart = anchorWeek + w * interval * 7;
      for (const offset of days) {
        const dayNumber = weekStart + offset;
        if (dayNumber < anchorDay) continue;
        const instant = at(dayNumber);
        if (instant > after) return instant;
      }
    }
    return null;
  }

  // MONTHLY and YEARLY step whole months.
  const stepMonths = rule.freq === "MONTHLY" ? interval : interval * 12;
  const anchorMonth = a.year * 12 + (a.month - 1);
  const afterCivil = civilOfDayNumber(afterDay);
  const afterMonth = afterCivil.year * 12 + (afterCivil.month - 1);
  const wanted = rule.freq === "MONTHLY" ? (rule.byMonthDay ?? a.day) : a.day;
  let k = Math.max(0, Math.floor((afterMonth - anchorMonth) / stepMonths) - 1);
  for (let step = 0; step < MAX_STEPS; step += 1, k += 1) {
    const monthIndex = anchorMonth + k * stepMonths;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const length = daysInMonth(year, month);
    const day = wanted === -1 ? length : Math.min(wanted, length);
    const dayNumber = dayNumberOf(year, month, day);
    if (dayNumber < anchorDay) continue;
    const instant = at(dayNumber);
    if (instant > after) return instant;
  }
  return null;
}

/** Presets the repeat control offers; "custom" edits the rule fields directly. */
export type RepeatPreset = "daily" | "weekdays" | "weekly" | "fortnightly" | "monthly" | "yearly";

export function presetRule(preset: RepeatPreset, anchor: Date, timeZone: string): RecurrenceRule {
  const parts = localParts(anchor, timeZone);
  const weekday = WEEKDAYS[parts.weekday]!;
  switch (preset) {
    case "daily":
      return { freq: "DAILY", interval: 1 };
    case "weekdays":
      return { freq: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"] };
    case "weekly":
      return { freq: "WEEKLY", interval: 1, byDay: [weekday] };
    case "fortnightly":
      return { freq: "WEEKLY", interval: 2, byDay: [weekday] };
    case "monthly":
      return { freq: "MONTHLY", interval: 1, byMonthDay: parts.day };
    case "yearly":
      return { freq: "YEARLY", interval: 1 };
  }
}

/* ---------- Assignee rule ---------- */

export type AssigneeRule = { type: "FIXED"; userIds: string[] } | { type: "ROTATE"; userIds: string[]; index: number };

/** Defensive read of the stored JSON (unknown shapes become "nobody"). */
export function parseAssigneeRule(value: unknown): AssigneeRule {
  const source = (value && typeof value === "object" ? value : {}) as { type?: unknown; userIds?: unknown; index?: unknown };
  const userIds = Array.isArray(source.userIds) ? source.userIds.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 50) : [];
  if (source.type === "ROTATE") {
    const index = typeof source.index === "number" && Number.isInteger(source.index) && source.index >= 0 ? source.index : 0;
    return { type: "ROTATE", userIds, index };
  }
  return { type: "FIXED", userIds };
}

/** Who gets the next instance, and the rule to store afterwards (rotation advances). */
export function nextAssignees(rule: AssigneeRule, eligible?: ReadonlySet<string>): { userIds: string[]; next: AssigneeRule } {
  const pool = eligible ? rule.userIds.filter((id) => eligible.has(id)) : rule.userIds;
  if (rule.type === "FIXED") return { userIds: pool, next: rule };
  if (pool.length === 0) return { userIds: [], next: rule };
  const pick = pool[rule.index % pool.length]!;
  return { userIds: [pick], next: { ...rule, index: (rule.index + 1) % Math.max(1, rule.userIds.length) } };
}
