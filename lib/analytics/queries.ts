import "server-only";
import { recordAuditEvent } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  analyticsAccess,
  AnalyticsError,
  type Actor,
  type Access,
} from "./access";
import { allowedDefinitions, factSql, type Definition } from "./definitions";
import {
  querySchema,
  periodFor,
  comparisons,
  metricValue,
  queryString,
  safeNumber,
  day,
} from "./metrics";
import { localDate } from "@/lib/finance/dates";
import type {
  AnalyticsQuery,
  Period,
  MetricResult,
  Point,
  Fact,
  PresetView,
  Section,
  ResolvedQuery,
  AnalyticsPickers,
  DashboardData,
  DrillData,
} from "./types";
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
function rangeSql(d: Definition, p: Period) {
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
export async function context(
  actor: Actor,
  raw: AnalyticsQuery,
  now = new Date(),
): Promise<{ access: Access; q: ResolvedQuery; p: Period }> {
  const access = await analyticsAccess(actor),
    q = querySchema.parse(raw);
  q.currency ??= access.workspace.currency;
  const p = periodFor(q, localDate(now, access.workspace.timezone));
  return { access, q, p };
}
const homeIds = [
  "income",
  "spending",
  "donations",
  "headcount",
  "tasks-completed",
  "overdue-tasks",
  "help-sla",
  "attendance",
  "grant-reports",
  "project-health",
  "budgets",
  "win-rate",
  "payables",
];
export async function loadMetrics(
  actor: Actor,
  raw: AnalyticsQuery = {},
  now = new Date(),
  pack = false,
  only?: readonly string[],
): Promise<{
  q: ResolvedQuery;
  period: Period;
  metrics: MetricResult[];
  access: Access;
}> {
  const { access, q, p } = await context(actor, raw, now);
  let defs = allowedDefinitions(access).filter(
    (d) =>
      (!only || only.includes(d.id)) &&
      applies(d, q) &&
      (q.section === "home" ? homeIds.includes(d.id) : d.section === q.section),
  );
  if (pack)
    defs = defs.filter(
      (d) =>
        d.gate !== "payroll" &&
        !["top-donors", "income-funder", "safeguarding"].includes(d.id),
    );
  const metrics: MetricResult[] = [];
  // Bound parallelism avoids exhausting the PostgreSQL pool on a shared host.
  for (let offset = 0; offset < defs.length; offset += 4)
    metrics.push(
      ...(await Promise.all(
        defs
          .slice(offset, offset + 4)
          .map((d) => metricResult(access, d, q, p, pack)),
      )),
    );
  return { q, period: p, metrics, access };
}
export async function drillRecords(
  actor: Actor,
  id: string,
  raw: AnalyticsQuery = {},
  limit = 50,
): Promise<DrillData> {
  const { access, q, p } = await context(actor, raw),
    d = allowedDefinitions(access).find((d) => d.id === id && applies(d, q));
  if (!d)
    throw new AnalyticsError(
      "That report is unavailable. Refresh and try again.",
    );
  const page = Math.max(1, Number(q.page ?? 1));
  const rows = await prisma.$queryRaw<
    {
      id: string;
      title: string;
      path: string;
      date: Date;
      label: string;
      value: Prisma.Decimal;
      base: Prisma.Decimal;
    }[]
  >(
    Prisma.sql`WITH facts AS (${await factSql(d, access, p.to, false, p, comparisons(p, q.period).previous, q)}) SELECT id,title,path,date,label,value,base FROM facts WHERE ${dimensionsSql(q)} AND ${rangeSql(d, p)} ${q.group ? Prisma.sql`AND label=${q.group}` : Prisma.empty} ${q.bucket ? Prisma.sql`AND left(date::text,${q.bucket.length}::int)=${q.bucket}` : Prisma.empty} ORDER BY date DESC,id LIMIT ${limit + 1} OFFSET ${(page - 1) * limit}`,
  );
  return {
    title: d.title,
    description: d.description,
    unit: d.unit,
    basisUnit: d.basisUnit ?? (d.unit === "percent" ? "count" : d.unit),
    q,
    period: p,
    page,
    more: rows.length > limit,
    rows: rows.slice(0, limit).map(
      (r) =>
        ({
          id: r.id,
          title: r.title,
          path: `/w/${access.workspace.slug}${r.path}`,
          date: day(r.date),
          label: r.label,
          value: safeNumber(r.value),
          base: safeNumber(r.base),
        }) satisfies Fact,
    ),
  };
}
export async function listPresets(actor: Actor): Promise<PresetView[]> {
  const a = await analyticsAccess(actor);
  const rows = await prisma.analyticsPreset.findMany({
    where: {
      workspaceId: a.workspace.id,
      OR: [{ ownerId: a.userId }, ...(a.admin ? [{ shared: true }] : [])],
    },
    orderBy: [{ pinned: "desc" }, { name: "asc" }],
    take: 100,
  });
  return rows.map((r) => ({
    ...r,
    fileIds: r.ownerId === a.userId ? r.fileIds : [],
    query: r.query as AnalyticsQuery,
  }));
}
export async function pickers(a: Access): Promise<AnalyticsPickers> {
  const ws = a.workspace.id;
  const [funds, centres, teams, projects, programmes, admins] =
    await Promise.all([
      a.finance
        ? prisma.financeFund.findMany({
            where: { workspaceId: ws, archivedAt: null },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : [],
      a.finance
        ? prisma.financeCostCentre.findMany({
            where: { workspaceId: ws, archivedAt: null },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          })
        : [],
      prisma.team.findMany({
        where: {
          workspaceId: ws,
          archivedAt: null,
          ...(!a.admin
            ? {
                OR: [
                  { visibility: "PUBLIC" as const },
                  { members: { some: { userId: a.userId } } },
                ],
              }
            : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.project.findMany({
        where: {
          workspaceId: ws,
          status: { not: "ARCHIVED" },
          ...(!a.admin
            ? {
                OR: [
                  { teamId: null },
                  { team: { visibility: "PUBLIC" as const } },
                  { team: { members: { some: { userId: a.userId } } } },
                ],
              }
            : {}),
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      a.admin
        ? prisma.fundingRecord.findMany({
            where: { workspaceId: ws, kind: "PROGRAMME", archivedAt: null },
            select: { id: true, title: true },
            orderBy: { title: "asc" },
          })
        : [],
      a.admin
        ? prisma.membership.findMany({
            where: {
              workspaceId: ws,
              status: "ACTIVE",
              role: { in: ["OWNER", "ADMIN"] },
              user: { disabledAt: null },
            },
            select: { userId: true, user: { select: { name: true } } },
          })
        : [],
    ]);
  return {
    funds,
    centres,
    teams,
    projects,
    admins: admins.map((m) => ({ id: m.userId, name: m.user.name ?? "Admin" })),
    programmes: programmes.map((r) => ({ id: r.id, name: r.title })),
  };
}
export async function loadDashboard(
  actor: Actor,
  query: AnalyticsQuery,
): Promise<DashboardData> {
  const data = await loadMetrics(actor, query);
  const [presets, options] = await Promise.all([
    listPresets(actor),
    pickers(data.access),
  ]);
  return {
    q: data.q,
    period: data.period,
    metrics: data.metrics,
    viewerId: data.access.userId,
    workspaceName: data.access.workspace.name,
    timezone: data.access.workspace.timezone,
    admin: data.access.admin,
    sections: [
      "home",
      ...new Set(allowedDefinitions(data.access).map((d) => d.section)),
    ] as Section[],
    presets,
    options,
  };
}
export type { DashboardData, DrillData } from "./types";
