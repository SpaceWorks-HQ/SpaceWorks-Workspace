/** Date-only helpers for the kitty (client-safe). Ledger and invoice dates are @db.Date values at UTC midnight. */

/** The calendar date (YYYY-MM-DD) of `now` in a time zone. */
export function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** YYYY-MM-DD → a Date at UTC midnight (how Prisma stores @db.Date). */
export function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** A date-only value back to YYYY-MM-DD. */
export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The last `count` calendar months (YYYY-MM) ending with the one containing `today` (YYYY-MM-DD). */
export function monthKeys(today: string, count: number): string[] {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 7));
  return keys;
}

/** "13 Oct 2026" for a date-only value (formatted in UTC so the day never shifts). */
export function formatDay(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}
