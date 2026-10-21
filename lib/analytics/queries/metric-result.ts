import "server-only";
import { recordAuditEvent } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AnalyticsError, type Access } from "../access";
import { factSql, type Definition } from "../definitions";
import { comparisons, metricValue, queryString, safeNumber } from "../metrics";
import type { AnalyticsQuery, Period, MetricResult, Point } from "../types";
export function dimensionsSql(q: AnalyticsQuery) {
  return Prisma.join(
    [
      Prisma.sql`(currency IS NULL OR currency=${q.currency})`,
      ...(["fund", "centre", "team", "project", "programme"] as const)
        .filter((k) => q[k])
        .map((k) =>
          k === "team"
            ? Prisma.sql`(team=${q[k]} OR ${q[k]}=ANY(teamids))`
            : Prisma.sql`${Prisma.raw(k)}=${q[k]}`,
        ),
    ],
    " AND ",
  );
}
export function applies(d: Definition, q: AnalyticsQuery) {
  return (["fund", "centre", "team", "project", "programme"] as const).every(
    (k) => !q[k] || !!d.dimensions?.[k],
  );
}
export function rangeSql(d: Definition, p: Period) {
  if (d.snapshot && d.eligibilityDate)
    return Prisma.sql`eligibility_date<=${p.to}::date`;
  if (d.snapshot)
    return d.id === "budgets"
      ? Prisma.sql`date<=${p.to}::date`
      : d.id === "remittances"
        ? Prisma.sql`date IS NOT NULL`
        : Prisma.sql`date<=${p.to}::date`;
  return Prisma.sql`date BETWEEN ${p.from}::date AND ${p.to}::date`;
}
export function valueFor(
  d: Pick<Definition, "mode">,
  value: number,
  base: number,
  count: number,
) {
  return metricValue(d.mode, value, base, count);
}
export async function metricResult(
  a: Access,
  d: Definition,
  q: AnalyticsQuery,
  p: Period,
  pack = false,
): Promise<MetricResult> {
  if (d.gate === "payroll" || d.permission === "safeguarding")
    await recordAuditEvent({
      workspaceId: a.workspace.id,
      actorId: a.userId,
      action: "analytics.restricted_metric_viewed",
      targetType: "analytics",
      targetId: d.id,
    });
  const bucketDigits =
    d.chart === "calendar" ||
    Date.parse(p.to) - Date.parse(p.from) < 62 * 86400000
      ? 10
      : 7;
  const c = comparisons(p, q.period),
    periods = [p, c.previous, c.lastYear];
  // SLA observations depend on the window's end, including comparison windows.
  const windowFacts = d.value === "sla"
    ? await Promise.all(periods.map((period) =>
        factSql(d, a, period.to, pack, period, comparisons(period, q.period).previous, q),
      ))
    : null;
  const results = await prisma.$queryRaw<
    {
      window: number;
      label: string;
      value: Prisma.Decimal;
      base: Prisma.Decimal;
      count: bigint;
      bucket: string;
    }[]
  >(Prisma.sql`
 WITH ${windowFacts ? Prisma.empty : Prisma.sql`facts AS (${await factSql(d, a, p.to, pack, p, c.previous, q)}),`} windows AS (
 ${Prisma.join(
   periods.map(
     (period, i) =>
       Prisma.sql`SELECT ${i}::int AS "window",f.* FROM ${windowFacts ? Prisma.sql`(${windowFacts[i]})` : Prisma.raw("facts")} f WHERE ${dimensionsSql(q)} AND ${rangeSql(d, period)} ${d.snapshot && i > 0 ? Prisma.sql`AND FALSE` : Prisma.empty}`,
   ),
   " UNION ALL ",
 )}
 ) SELECT "window",label,left(date::text,${bucketDigits}::int) AS bucket,sum(value) AS value,sum(base) AS base,count(*) AS count
 FROM windows GROUP BY "window",label,bucket ORDER BY "window",label,bucket LIMIT 10001`);
  if (results.length > 10000)
    throw new AnalyticsError(
      "Choose a shorter period or a narrower filter for this report.",
    );
  const total = (w: number) => {
    const rows = results.filter((r) => r.window === w);
    return {
      value: rows.reduce((n, r) => n + safeNumber(r.value), 0),
      base: rows.reduce((n, r) => n + safeNumber(r.base), 0),
      count: rows.reduce((n, r) => n + safeNumber(r.count), 0),
    };
  };
  const current = total(0),
    previous = total(1),
    lastYear = total(2);
  function points(kind: "label" | "bucket"): Point[] {
    const groups = new Map<
      string,
      { value: number; base: number; count: number }
    >();
    for (const r of results.filter((r) => r.window === 0)) {
      const key = r[kind],
        g = groups.get(key) ?? { value: 0, base: 0, count: 0 };
      g.value += safeNumber(r.value);
      g.base += safeNumber(r.base);
      g.count += safeNumber(r.count);
      groups.set(key, g);
    }
    // Event totals can fall to zero. Keep baseline-only categories visible;
    // rates/averages must not invent observations, and trends stay in-period.
    if (kind === "label" && d.mode === "sum") {
      for (const row of results)
        if (!groups.has(row.label))
          groups.set(row.label, { value: 0, base: 0, count: 0 });
    }
    const entries = [...groups];
    if (kind === "bucket") entries.sort(([a], [b]) => a.localeCompare(b));
    const pointValue = (value: number, base: number, count: number) =>
      kind === "label" && d.id === "win-rate"
        ? count
        : valueFor(d, value, base, count);
    return entries.map(([label, g]) => {
      const prev = results.filter((r) => r.window === 1 && r[kind] === label),
        year = results.filter((r) => r.window === 2 && r[kind] === label);
      return {
        label,
        value: pointValue(g.value, g.base, g.count) ?? 0,
        base: g.base,
        count: g.count,
        numerator: g.value,
        previous: d.snapshot
          ? null
          : pointValue(
              prev.reduce((n, r) => n + safeNumber(r.value), 0),
              prev.reduce((n, r) => n + safeNumber(r.base), 0),
              prev.reduce((n, r) => n + safeNumber(r.count), 0),
            ),
        lastYear: d.snapshot
          ? null
          : pointValue(
              year.reduce((n, r) => n + safeNumber(r.value), 0),
              year.reduce((n, r) => n + safeNumber(r.base), 0),
              year.reduce((n, r) => n + safeNumber(r.count), 0),
            ),
      };
    });
  }
  const base = `/w/${a.workspace.slug}/analytics`;
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    unit: d.unit,
    chart: d.chart,
    snapshot: !!d.snapshot,
    value: valueFor(d, current.value, current.base, current.count),
    previous: d.snapshot
      ? null
      : valueFor(d, previous.value, previous.base, previous.count),
    lastYear: d.snapshot
      ? null
      : valueFor(d, lastYear.value, lastYear.base, lastYear.count),
    count: current.count,
    numerator: current.value,
    denominator: current.base,
    groups: points("label"),
    trend: points("bucket"),
    drill: `${base}/drill/${d.id}?${queryString(q)}`,
    csv: `${base}/export?${queryString(q, { metric: d.id })}`,
  };
}
