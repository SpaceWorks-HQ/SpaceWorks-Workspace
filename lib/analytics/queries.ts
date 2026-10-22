import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  analyticsAccess,
  AnalyticsError,
  type Actor,
  type Access,
} from "./access";
import { allowedDefinitions, factSql } from "./definitions";
import {
  querySchema,
  periodFor,
  comparisons,
  safeNumber,
  day,
} from "./metrics";
import { localDate } from "@/lib/finance/dates";
import type {
  AnalyticsQuery,
  Period,
  MetricResult,
  Fact,
  PresetView,
  Section,
  ResolvedQuery,
  AnalyticsPickers,
  DashboardData,
  DrillData,
} from "./types";
export { dimensionsSql, applies, valueFor, metricResult } from "./queries/metric-result";
import { dimensionsSql, applies, rangeSql, metricResult } from "./queries/metric-result";

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
