import type { AvailabilityType } from "@prisma/client";
import { addDays, dayKey, startOfDay } from "@/lib/community/schedule";

/**
 * Away periods (pure and client-safe). Rows are half-open intervals
 * [startsAt, endsAt) in UTC; calendar days are workspace-zone day keys.
 */

export const AVAILABILITY_TYPES: readonly AvailabilityType[] = ["AWAY", "LIMITED", "TRAVEL", "BUSY"] as const;

export const AVAILABILITY_LABELS: Record<AvailabilityType, string> = {
  AWAY: "Away",
  LIMITED: "Limited",
  TRAVEL: "Travelling",
  BUSY: "Busy",
};

/** Status pill tone per type (always shown with the word). */
export const AVAILABILITY_TONES: Record<AvailabilityType, "warning" | "info" | "neutral" | "accent"> = {
  AWAY: "warning",
  LIMITED: "info",
  TRAVEL: "accent",
  BUSY: "neutral",
};

export type Period = { startsAt: Date; endsAt: Date };

/** Do two half-open intervals share any instant? Touching ends do not overlap. */
export function overlaps(a: Period, b: Period): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** Periods covering `now`. */
export function activeAt<T extends Period>(periods: readonly T[], now: Date): T[] {
  const t = now.getTime();
  return periods.filter((period) => period.startsAt.getTime() <= t && t < period.endsAt.getTime());
}

/** The first period that overlaps `candidate` (for "you already said you're away then"). */
export function firstOverlap<T extends Period>(periods: readonly T[], candidate: Period): T | null {
  return periods.find((period) => overlaps(period, candidate)) ?? null;
}

/** UTC range of whole workspace-zone days: [start of `fromKey`, start of `toKey` + 1 day). */
export function dayRange(fromKey: string, toKey: string, timeZone: string): Period {
  return { startsAt: startOfDay(fromKey, timeZone), endsAt: startOfDay(addDays(toKey, 1), timeZone) };
}

/** Day keys from `startKey`, `count` days long. */
export function dayKeys(startKey: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDays(startKey, index));
}

export type StripCell<T> = { day: string; periods: T[] };
export type StripRow<P, T> = { person: P; cells: StripCell<T>[]; awayDays: number };

/**
 * Team availability strip: for each person, which of the `days` (workspace
 * zone) are covered by one of their periods. A period counts for a day when
 * it overlaps any part of that day.
 */
export function availabilityStrip<P extends { id: string }, T extends Period & { userId: string }>(
  people: readonly P[],
  periods: readonly T[],
  days: readonly string[],
  timeZone: string,
): StripRow<P, T>[] {
  const ranges = days.map((day) => ({ day, range: dayRange(day, day, timeZone) }));
  const byUser = new Map<string, T[]>();
  for (const period of periods) {
    const list = byUser.get(period.userId) ?? [];
    list.push(period);
    byUser.set(period.userId, list);
  }
  return people.map((person) => {
    const mine = byUser.get(person.id) ?? [];
    const cells = ranges.map(({ day, range }) => ({ day, periods: mine.filter((period) => overlaps(period, range)) }));
    return { person, cells, awayDays: cells.filter((cell) => cell.periods.length > 0).length };
  });
}

/** "Away until Fri 18 Oct" style end day: the last day covered (end is exclusive). */
export function lastDayKey(period: Period, timeZone: string): string {
  return dayKey(new Date(period.endsAt.getTime() - 1), timeZone);
}
