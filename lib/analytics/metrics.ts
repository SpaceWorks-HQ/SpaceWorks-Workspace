import { formatDate } from "@/lib/format/datetime";
import type {
  AnalyticsQuery,
  Period,
  ForecastLine,
  ForecastBucket,
  Unit,
} from "./types";
import { currencyMinorDigits, parseMoneyToMinor } from "@/lib/format/money";
import { dateSchema } from "./metrics/validation";
export { dateSchema, querySchema } from "./metrics/validation";
const DAY = 86400000;
export function day(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function addDays(s: string, n: number) {
  return day(new Date(Date.parse(s) + n * DAY));
}
export function addMonths(s: string, n: number) {
  const d = new Date(s);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  target.setUTCDate(
    Math.min(
      d.getUTCDate(),
      new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return day(target);
}
export function periodFor(query: AnalyticsQuery, today: string): Period {
  const d = new Date(today),
    y = d.getUTCFullYear(),
    m = d.getUTCMonth();
  if (query.period === "custom") {
    const from = dateSchema.parse(query.from),
      to = dateSchema.parse(query.to);
    if (from > to || Date.parse(to) - Date.parse(from) > 732 * DAY)
      throw new Error(
        "Choose a period of up to two years, with the end after the start.",
      );
    return { from, to };
  }
  if (query.period === "last-month")
    return {
      from: day(new Date(Date.UTC(y, m - 1, 1))),
      to: day(new Date(Date.UTC(y, m, 0))),
    };
  const start =
    query.period === "fy"
      ? new Date(Date.UTC(m < 3 ? y - 1 : y, 3, 1))
      : query.period === "quarter"
        ? new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))
        : new Date(Date.UTC(y, m, 1));
  // Current periods stop today so comparisons are like-for-like.
  return { from: day(start), to: today };
}
export function comparisons(p: Period, kind?: string) {
  const span = Math.round((Date.parse(p.to) - Date.parse(p.from)) / DAY) + 1;
  let previous = { from: addDays(p.from, -span), to: addDays(p.from, -1) };
  if (
    kind === "month" ||
    kind === "last-month" ||
    kind === "quarter" ||
    kind === "fy"
  ) {
    const months = kind === "quarter" ? 3 : kind === "fy" ? 12 : 1,
      from = addMonths(p.from, -months),
      end = addDays(p.from, -1);
    const currentEnd = addDays(addMonths(p.from, months), -1);
    previous = {
      from,
      to: p.to === currentEnd ? end : [addDays(from, span - 1), end].sort()[0]!,
    };
  } else if (
    p.from.endsWith("-01-01") &&
    p.to === `${p.from.slice(0, 4)}-12-31`
  )
    previous = { from: addMonths(p.from, -12), to: addMonths(p.to, -12) };
  return {
    previous,
    lastYear: { from: addMonths(p.from, -12), to: addMonths(p.to, -12) },
  };
}

export function ageingBucket(due: string, asOf: string) {
  const n = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(due)) / DAY));
  return n <= 30 ? "0–30" : n <= 60 ? "31–60" : n <= 90 ? "61–90" : "90+";
}
export function rate(n: number, d: number) {
  return d > 0 ? (n / d) * 100 : null;
}
export function average(n: number, d: number) {
  return d > 0 ? n / d : null;
}
export function delta(current: number | null, previous: number | null) {
  return current === null || previous === null
    ? null
    : previous === 0
      ? current === 0
        ? 0
        : null
      : ((current - previous) / Math.abs(previous)) * 100;
}
export function donorRetention(previous: string[], current: string[]) {
  const p = new Set(previous.filter(Boolean)),
    c = new Set(current.filter(Boolean));
  const retained = [...p].filter((id) => c.has(id)).length;
  return {
    newDonors: [...c].filter((id) => !p.has(id)).length,
    recurring: retained,
    lapsed: [...p].filter((id) => !c.has(id)).length,
    percent: rate(retained, p.size),
  };
}
export function monthlyBurn(
  expense: number,
  income: number,
  days: number,
  cash: number,
) {
  const gross = days > 0 ? (expense / days) * 30.4375 : 0,
    net = days > 0 ? ((expense - income) / days) * 30.4375 : 0;
  return {
    grossMinor: Math.round(gross),
    netMinor: Math.round(net),
    runwayMonths: net > 0 ? Math.max(0, cash) / net : null,
  };
}
export function sla(
  created: Date,
  resolved: Date | null,
  due: Date,
  asOf: Date,
) {
  return {
    minutes: resolved ? Math.max(0, (+resolved - +created) / 60000) : null,
    missed: +(resolved ?? asOf) > +due,
  };
}
export function mttr(rows: { startedAt: Date; resolvedAt: Date | null }[]) {
  const complete = rows.filter((r) => r.resolvedAt);
  return average(
    complete.reduce(
      (s, r) => s + Math.max(0, (+r.resolvedAt! - +r.startedAt) / 60000),
      0,
    ),
    complete.length,
  );
}
export function winRate(won: number, lost: number) {
  return rate(won, won + lost);
}
/** Inclusive start and exclusive end, both derived from the original anchor. */
export function forecastBucketPeriod(
  start: string,
  index: number,
  unit: "week" | "month",
) {
  return {
    from: unit === "week" ? addDays(start, index * 7) : addMonths(start, index),
    to:
      unit === "week"
        ? addDays(start, (index + 1) * 7)
        : addMonths(start, index + 1),
  };
}
export function forecastBuckets(
  lines: ForecastLine[],
  opening: number,
  start: string,
  count: number,
  unit: "week" | "month",
  threshold: number,
): ForecastBucket[] {
  let closing = opening;
  return Array.from({ length: count }, (_, i) => {
    const { from, to } = forecastBucketPeriod(start, i, unit);
    const matching = lines.filter((l) => l.date >= from && l.date < to),
      income = matching.reduce((s, l) => s + Math.max(0, l.amountMinor), 0),
      expense = matching.reduce((s, l) => s + Math.max(0, -l.amountMinor), 0);
    closing += income - expense;
    return {
      label: from,
      incomeMinor: income,
      expenseMinor: expense,
      closingMinor: closing,
      low: closing < threshold,
    };
  });
}
export function safeNumber(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)
    throw new Error("Narrow the report to keep totals within range.");
  return n;
}
export function displayValue(
  value: number | null,
  unit: Unit,
  currency: string,
  code = false,
) {
  if (value === null) return "Not recorded";
  if (unit === "money")
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      currencyDisplay: code ? "code" : "symbol",
      maximumFractionDigits: currencyMinorDigits(currency),
    })
      .format(value / 10 ** currencyMinorDigits(currency))
      .replace(/\u00a0/g, " ");
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value)}${unit === "percent" ? "%" : unit === "count" ? "" : ` ${unit}`}`;
}
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            const t = String(v ?? "");
            return (
              '"' +
              (typeof v === "string" && /^[\s]*[=+\-@]/.test(t) ? "'" : "") +
              t.replaceAll('"', '""') +
              '"'
            );
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function queryString(
  q: AnalyticsQuery,
  extra: Record<string, string | undefined> = {},
) {
  return new URLSearchParams(
    Object.entries({ ...q, ...extra }).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
    ),
  ).toString();
}

export function displayDay(value: string) {
  return formatDate(new Date(`${value}T12:00:00Z`), "UTC");
}

export function metricValue(
  mode: "sum" | "rate" | "average",
  value: number,
  base: number,
  count: number,
) {
  return mode === "sum"
    ? value
    : count === 0
      ? null
      : mode === "rate"
        ? rate(value, base)
        : average(value, base);
}

/** Signed currency input; storage remains integer minor units. */
export function parseCashAmount(
  input: string,
  currency: string,
): number | null {
  const value = input.trim().replaceAll(",", "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return null;
  const amount = parseMoneyToMinor(value.replace(/^[+-]/, ""), currency);
  return amount === null ? null : value.startsWith("-") ? -amount : amount;
}
