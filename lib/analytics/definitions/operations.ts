import "server-only";
import type { DefinitionRegistry } from "./registry";
import { help, marketing } from "./sources";

export function registerOperations({ add }: DefinitionRegistry) {
  add(
    "help-volume",
    "operations",
    "Help-desk requests",
    "Only requests you could open directly; confidential requests require requester or designated-handler access.",
    { ...help },
  );
  add(
    "help-resolution",
    "operations",
    "Help-desk resolution time",
    "Minutes to resolution for resolved requests created in the period. Open requests are excluded.",
    {
      ...help,
      value: 'greatest(0,extract(epoch from(r."resolvedAt"-r."createdAt"))/60)',
      base: "1",
      where: 'r."resolvedAt" IS NOT NULL',
      mode: "average",
      unit: "minutes",
    },
  );
  add(
    "help-sla",
    "operations",
    "Help-desk SLA misses",
    "Resolved after due, or still open after due at the reporting end. Resolution SLA is the only stored target.",
    { ...help, value: "sla", base: "1", mode: "rate", unit: "percent" },
  );
  add(
    "help-first-response",
    "operations",
    "First staff response",
    "Minutes to the earliest non-internal response by someone other than the requester. No stored first-response SLA target; unanswered requests are excluded.",
    {
      ...help,
      join: 'JOIN LATERAL (SELECT min(h."createdAt") AS first FROM "HelpTicketComment" h WHERE h."workspaceId"=r."workspaceId" AND h."ticketId"=r.id AND h."authorId"<>r."requesterId" AND NOT h.internal) h ON h.first IS NOT NULL',
      value: 'greatest(0,extract(epoch from(h.first-r."createdAt"))/60)',
      base: "1",
      mode: "average",
      unit: "minutes",
    },
  );
  add(
    "safety",
    "operations",
    "Safety reports",
    "Reports by type. Members see their own reports; admins see the register.",
    {
      table: '"SafetyReport" r',
      date: 'r."occurredAt"',
      titleSql: "r.title",
      path: "'/safety/'||r.id",
      label: "r.kind::text",
      permission: "safety",
    },
  );
  add(
    "safety-followups",
    "operations",
    "Safety follow-up closure",
    "Follow-ups due in the period. Only admins can view the handling team's follow-ups.",
    {
      table: '"SafetyFollowUp" r',
      join: 'JOIN "SafetyReport" sr ON sr.id=r."reportId" AND sr."workspaceId"=r."workspaceId"',
      date: 'r."dueAt"',
      titleSql: "r.title",
      path: "'/safety/'||r.\"reportId\"",
      label: "'Follow-ups'",
      value: 'CASE WHEN r."completedAt" IS NOT NULL THEN 1 ELSE 0 END',
      base: "1",
      unit: "percent",
      mode: "rate",
      gate: "admin",
    },
  );
  add(
    "uptime",
    "operations",
    "Monitoring availability",
    "Up and degraded checks divided by non-maintenance checks from retained hourly rollups. Missing samples are not assumed healthy; older unretained data is unavailable.",
    {
      table: '"MonitorRollup" r',
      join: 'JOIN "Monitor" mon ON mon.id=r."monitorId" AND mon."workspaceId"=r."workspaceId"',
      date: 'r."bucketStart"',
      titleSql: "mon.name",
      path: "'/services/monitors/'||r.\"monitorId\"",
      where: "r.granularity='HOUR'",
      label: "mon.name",
      value: "r.up+r.degraded",
      base: "greatest(0,r.total-r.maintenance)",
      unit: "percent",
      mode: "rate",
      permission: "service",
    },
  );
  add(
    "mttr",
    "operations",
    "Incident MTTR",
    "Mean minutes from incident start to resolution; unresolved incidents excluded.",
    {
      table: '"Incident" r',
      date: 'r."resolvedAt"',
      titleSql: "r.title",
      path: "'/services/incidents/'||r.number",
      label: "r.severity::text",
      where: 'r."resolvedAt" IS NOT NULL',
      value: 'greatest(0,extract(epoch from(r."resolvedAt"-r."startedAt"))/60)',
      base: "1",
      unit: "minutes",
      mode: "average",
      permission: "service",
    },
  );
  for (const [id, title, kind, label] of [
    [
      "security",
      "Security incidents",
      "INCIDENT",
      "coalesce(r.details->>'severity','Not recorded')",
    ],
    ["access-reviews", "Access reviews completed", "REVIEW", "r.status"],
    ["renewal-contracts", "Contracts renewing", "CONTRACT", "r.status"],
  ] as const) {
    if (kind === "CONTRACT") continue;
    add(
      id,
      "operations",
      title,
      id === "security"
        ? "Incidents by detection date in the workspace time zone; private details stay in the source tool."
        : "Current internal register; private incident details stay in their source tool.",
      {
        ...marketing,
        gate: "admin",
        // INCIDENT requires detectedAt in marketingIt/schema.ts; dateOn is unrelated and optional.
        date: id === "access-reviews" ? 'r."completedAt"' : "(nullif(r.details->>'detectedAt','')::timestamptz AT TIME ZONE 'UTC')",
        dateOnly: id !== "security",
        where: `${marketing.where} AND r.kind='${kind}'${id === "access-reviews" ? " AND r.status='COMPLETED'" : ""}`,
        label,
      },
    );
  }
  add(
    "devices",
    "operations",
    "Device assignment utilisation",
    "Assigned active inventory assets / non-retired assets. Inventory is authoritative, including handovers elsewhere.",
    {
      table: '"Asset" r',
      date: 'r."createdAt"',
      titleSql: "r.name",
      path: "'/assets#'||r.id",
      label: "r.category",
      snapshot: true,
      where:
        'r.status<>\'RETIRED\' AND EXISTS(SELECT 1 FROM "MarketingItRecord" device WHERE device."workspaceId"=r."workspaceId" AND device."assetId"=r.id AND device.kind=\'DEVICE\' AND device."archivedAt" IS NULL)',
      value: 'CASE WHEN r."ownerUserId" IS NOT NULL THEN 1 ELSE 0 END',
      base: "1",
      unit: "percent",
      mode: "rate",
      gate: "admin",
    },
  );
  add(
    "licences",
    "operations",
    "Licence seat utilisation",
    "Assigned seats / purchased seats in active licence records. No usage telemetry is implied.",
    {
      ...marketing,
      gate: "admin",
      snapshot: true,
      where: `${marketing.where} AND r.kind='LICENCE' AND r.status='ACTIVE'`,
      label: "r.title",
      value: "jsonb_array_length(coalesce(r.details->'assigneeIds','[]'::jsonb))",
      base: "coalesce((r.details->>'seats')::numeric,0)",
      unit: "percent",
      mode: "rate",
    },
  );
}
