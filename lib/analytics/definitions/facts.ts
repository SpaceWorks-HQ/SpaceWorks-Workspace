import "server-only";
import { localDate } from "@/lib/finance/dates";
import { fromDateInputValue } from "@/lib/tasks/localDate";
import { addDays } from "../metrics";
import { budgetActualSql } from "@/lib/finance/reportMetrics";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { meetingWhere } from "@/lib/meetings/service";
import type { Access } from "../access";
import type { Period, AnalyticsQuery } from "../types";
import type { Definition } from "./types";
import { funding } from "./sources";
/** Static SQL fragments come only from the reviewed registry, never query parameters. */
export async function factSql(
  d: Definition,
  a: Access,
  asOf: string,
  pack = false,
  period?: Period,
  previousPeriod?: Period,
  q: AnalyticsQuery = {},
) {
  const raw = Prisma.raw,
    ws = a.workspace.id,
    uid = a.userId;
  if (d.id === "retention" && period) {
    const from = period.from,
      span =
        Math.round((Date.parse(period.to) - Date.parse(from)) / 86400000) + 1,
      prevFrom =
        previousPeriod?.from ??
        new Date(Date.parse(from) - span * 86400000).toISOString().slice(0, 10),
      prevTo =
        previousPeriod?.to ??
        new Date(Date.parse(from) - 86400000).toISOString().slice(0, 10);
    // Filter gifts before grouping: a donor may support several funds/programmes.
    const scope = (["fund", "programme"] as const)
      .filter((key) => q[key])
      .map((key) => Prisma.sql`AND (${raw(funding.dimensions[key])})=${q[key]}`);
    return Prisma.sql`WITH donors AS (SELECT r."contactId",r.currency,min(r.id) AS gift_id,
   bool_or(r."dateOn" BETWEEN ${from}::date AND ${asOf}::date) AS current,
   bool_or(r."dateOn" BETWEEN ${prevFrom}::date AND ${prevTo}::date) AS previous
   FROM "FundingRecord" r WHERE r."workspaceId"=${ws} AND r.kind='DONATION' AND r.status='RECEIVED' AND r."archivedAt" IS NULL AND r."contactId" IS NOT NULL AND coalesce(r.details->>'mode','')<>'IN_KIND' ${scope.length ? Prisma.join(scope, " ") : Prisma.empty} AND (r."dateOn" BETWEEN ${prevFrom}::date AND ${prevTo}::date OR r."dateOn" BETWEEN ${from}::date AND ${asOf}::date) GROUP BY r."contactId",r.currency)
   SELECT (c."contactId"||':'||c.currency)::text AS id,coalesce(contact."displayName",'Former donor')::text AS title,('/funding/donations?edit='||c.gift_id)::text AS path,${asOf}::date AS date,
   CASE WHEN c.current AND c.previous THEN 'Retained' WHEN c.current THEN 'New' ELSE 'Lapsed' END::text AS label,
   CASE WHEN c.current AND c.previous THEN 1 ELSE 0 END::numeric AS value,CASE WHEN c.previous THEN 1 ELSE 0 END::numeric AS base,c.currency,
   ${q.fund ?? null}::text AS fund,NULL::text AS centre,NULL::text AS team,ARRAY[]::text[] AS teamids,NULL::text AS project,${q.programme ?? null}::text AS programme
   FROM donors c LEFT JOIN "Contact" contact ON contact.id=c."contactId" AND contact."workspaceId"=${ws} AND contact."deletedAt" IS NULL`;
  }

  const team =
    d.dimensions?.team ??
    (d.table.startsWith('"Project"') ? 'r."teamId"' : null);
  const visibleTeam = team
    ? Prisma.sql`AND (${raw(team)} IS NULL OR NOT EXISTS(SELECT 1 FROM "Team" vt WHERE vt.id=${raw(team)} AND vt."workspaceId"=${ws} AND vt.visibility='PRIVATE' AND NOT EXISTS(SELECT 1 FROM "TeamMember" tm WHERE tm."teamId"=vt.id AND tm."userId"=${uid})))`
    : Prisma.empty;
  let permission = Prisma.empty;
  if (
    !a.admin &&
    ["task", "project", "meeting", "service"].includes(d.permission ?? "")
  )
    permission = visibleTeam;

  if (d.permission === "help")
    permission = Prisma.sql`AND (r."requesterId"=${uid} OR (${a.admin} AND (NOT r.confidential OR ${uid}=ANY(r."handlerIds")))) ${pack ? Prisma.sql`AND NOT r.confidential` : Prisma.empty}`;
  if (d.permission === "safety" && !a.admin)
    permission = Prisma.sql`AND r."reporterId"=${uid}`;
  if (d.permission === "volunteer" && !a.admin)
    permission = Prisma.sql`AND r."userId"=${uid}`;
  if (d.permission === "attendance" && !a.admin)
    permission = Prisma.sql`AND (r."userId"=${uid} OR EXISTS(SELECT 1 FROM "MemberProfile" vp WHERE vp."workspaceId"=${ws} AND vp."userId"=r."userId" AND vp."managerId"=${uid}))`;
  if (d.permission === "safeguarding")
    permission = Prisma.sql`AND ${!pack} AND ${uid}=ANY(r."handlerIds") AND EXISTS(SELECT 1 FROM "SafeguardingHandler" sh JOIN "GovernanceRecord" committee ON committee.id=sh."committeeId" AND committee."workspaceId"=sh."workspaceId" WHERE sh."workspaceId"=${ws} AND sh."userId"=${uid} AND sh."revokedAt" IS NULL AND sh."endsOn">=${localDate(new Date(), a.workspace.timezone)}::date AND committee.kind='COMMITTEE' AND committee.status='ACTIVE' AND committee."archivedAt" IS NULL)`;
  if (d.permission === "meeting") {
    // Use the source predicate, including TEAM membership on public teams.
    const meetings = await prisma.meeting.findMany({
      where: await meetingWhere({
        user: { id: uid, name: null },
        workspace: a.workspace,
        membership: { role: a.role },
      }),
      select: { id: true },
    });
    permission = Prisma.sql`AND r.id=ANY(${meetings.map((m) => m.id)}::text[]) ${pack ? Prisma.sql`AND r.visibility='WORKSPACE'` : Prisma.empty}`;
  }
  let date = Prisma.sql`${raw(d.date)}::date`;
  if (!d.dateOnly)
    date = Prisma.sql`(${raw(d.date)} AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})::date`;
  if (d.person && d.date.startsWith('coalesce(r.\"engagementStart\"'))
    date = Prisma.sql`coalesce(r."engagementStart",(m."joinedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})::date)`;
  if (d.snapshot && d.date !== 'r."createdAt"')
    date = Prisma.sql`coalesce(${date},(r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})::date)`;
  const label =
    d.label === "ageing"
      ? Prisma.sql`CASE WHEN ${asOf}::date-${date}<=30 THEN '0–30' WHEN ${asOf}::date-${date}<=60 THEN '31–60' WHEN ${asOf}::date-${date}<=90 THEN '61–90' ELSE '90+' END`
      : d.label === "health"
        ? Prisma.sql`coalesce((SELECT u.status FROM "ProjectStatusUpdate" u WHERE u."workspaceId"=${ws} AND u."projectId"=r.id AND (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})::date<=${asOf}::date ORDER BY u."createdAt" DESC,u.id DESC LIMIT 1),'Not recorded')`
        : raw(d.label ?? "'Records'");
  if (d.id === "leave")
    permission = Prisma.sql`${permission} AND EXISTS(SELECT 1 FROM "Availability" av WHERE av."workspaceId"=${ws} AND av."userId"=r."subjectUserId" AND av.type='AWAY' AND (CASE WHEN nullif(req.data->>'availabilityId','') IS NOT NULL THEN av.id=req.data->>'availabilityId' WHEN pg_input_is_valid(req.data->>'from','date') AND pg_input_is_valid(req.data->>'to','date') THEN (av."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})=(req.data->>'from')::date::timestamp AND (av."endsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})=((req.data->>'to')::date+1)::timestamp ELSE FALSE END))`;
  if (d.id === "attendance")
    permission = Prisma.sql`${permission}
  AND EXISTS(SELECT 1 FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."workspaceId"=${ws} AND m."userId"=r."userId" AND m.status='ACTIVE' AND m.role<>'GUEST' AND u."disabledAt" IS NULL)
  AND NOT EXISTS(SELECT 1 FROM "ChecklistRun" lr JOIN "ChecklistRunItem" li ON li."runId"=lr.id
    CROSS JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(coalesce(li."descriptionMd",''),'jsonb') THEN li."descriptionMd"::jsonb ELSE '{}'::jsonb END AS data) leave_data
    WHERE lr."workspaceId"=${ws} AND lr."subjectUserId"=r."userId" AND lr.status='DONE' AND li."sourceType"='availability_request' AND coalesce(leave_data.data->>'type','AWAY')='AWAY'
    AND r."dateOn"::text BETWEEN leave_data.data->>'from' AND leave_data.data->>'to'
    AND EXISTS(SELECT 1 FROM "Availability" av WHERE av."workspaceId"=${ws} AND av."userId"=r."userId" AND av.type='AWAY'
      AND (CASE WHEN nullif(leave_data.data->>'availabilityId','') IS NOT NULL THEN av.id=leave_data.data->>'availabilityId'
      WHEN pg_input_is_valid(leave_data.data->>'from','date') AND pg_input_is_valid(leave_data.data->>'to','date') THEN (av."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})=(leave_data.data->>'from')::date::timestamp AND (av."endsAt" AT TIME ZONE 'UTC' AT TIME ZONE ${a.workspace.timezone})=((leave_data.data->>'to')::date+1)::timestamp ELSE FALSE END)))`;
  if (d.id === "knowledge" && !a.admin)
    permission = Prisma.sql`AND r.visibility='WORKSPACE'`;
  const slaCutoff = d.value === "sla"
    ? new Date(fromDateInputValue(addDays(asOf, 1), a.workspace.timezone)!.getTime() - 1)
    : null;
  const value =
    d.id === "budgets"
      ? budgetActualSql()
      : d.id === "blockers"
        ? Prisma.sql`greatest(0,${asOf}::date-${date})`
        : d.value === "sla"
          ? Prisma.sql`CASE WHEN r."slaDueAt"<=${slaCutoff}::timestamp AND (r."resolvedAt" IS NULL OR r."resolvedAt">r."slaDueAt") THEN 1 ELSE 0 END`
          : raw(d.value ?? "1");
  return Prisma.sql`SELECT r.id::text AS id, ${raw(d.titleSql)}::text AS title, ${raw(d.path)}::text AS path,
 ${date} AS date, ${d.eligibilityDate ? raw(d.eligibilityDate) : date} AS eligibility_date, coalesce(${label}::text,'Not recorded') AS label, (${value})::numeric AS value, (${raw(d.base ?? "0")})::numeric AS base,
 ${raw(d.unit === "money" || ["budgets", "campaigns", "grant-utilisation", "bom", "bom-received"].includes(d.id) ? (d.table.includes("MarketingIt") ? "r.details->>'currency'" : "r.currency") : "NULL::text")} AS currency,
 ${raw(d.dimensions?.fund ?? "NULL::text")} AS fund,${raw(d.dimensions?.centre ?? "NULL::text")} AS centre,${raw(d.dimensions?.team ?? "NULL::text")} AS team,${d.person ? Prisma.sql`ARRAY(SELECT tm."teamId" FROM "TeamMember" tm JOIN "Team" pt ON pt.id=tm."teamId" WHERE pt."workspaceId"=${ws} AND tm."userId"=${raw(d.person)} AND (${a.admin} OR pt.visibility='PUBLIC' OR EXISTS(SELECT 1 FROM "TeamMember" my WHERE my."teamId"=pt.id AND my."userId"=${uid})))` : Prisma.sql`ARRAY[]::text[]`} AS teamids,${raw(d.dimensions?.project ?? "NULL::text")} AS project,${raw(d.dimensions?.programme ?? "NULL::text")} AS programme
 FROM ${raw(d.table)} ${raw(d.join ?? "")} WHERE r."workspaceId"=${ws} AND (${raw(d.where ?? "TRUE")}) ${permission} ${d.id === "budgets" && period ? Prisma.sql`AND r."periodEnd">=${period.from}::date` : Prisma.empty}`;
}
