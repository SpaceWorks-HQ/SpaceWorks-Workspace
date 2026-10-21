import "server-only";
import type { DefinitionRegistry } from "./registry";
import { marketing } from "./sources";

export function registerMarketing({ add }: DefinitionRegistry) {
  add(
    "content",
    "marketing",
    "Content published vs planned",
    "Publication plans dated in the period; each row contributes to the plan denominator. Publication status is current.",
    {
      ...marketing,
      where: `${marketing.where} AND r.kind='CONTENT'`,
      date: "coalesce(nullif(r.details->>'publishAt','')::timestamptz::timestamp,r.\"dateOn\")",
      dateOnly: false,
      label: "coalesce(r.details->>'channel','Not recorded')",
      value: "CASE WHEN r.status='PUBLISHED' THEN 1 ELSE 0 END",
      base: "1",
      unit: "percent",
      mode: "rate",
      chart: "stacked",
      permission: "content",
    },
  );
  add(
    "reach",
    "marketing",
    "Social reach",
    "Recorded daily reach samples. This sums samples, not distinct people across channels.",
    {
      table: '"SocialMetricDaily" r',
      join: 'JOIN "SocialAccount" sa ON sa.id=r."accountId" AND sa."workspaceId"=r."workspaceId"',
      date: "r.date",
      dateOnly: true,
      titleSql: 'sa."displayName"',
      path: "'/social/accounts/'||r.\"accountId\"",
      where: "r.metric='reach'",
      label: "sa.platform::text",
      value: "r.value",
      chart: "line",
      permission: "social",
    },
  );
  add(
    "engagement",
    "marketing",
    "Social engagements",
    "Recorded daily engagement samples; missing metrics remain unrecorded.",
    {
      table: '"SocialMetricDaily" r',
      join: 'JOIN "SocialAccount" sa ON sa.id=r."accountId" AND sa."workspaceId"=r."workspaceId"',
      date: "r.date",
      dateOnly: true,
      titleSql: 'sa."displayName"',
      path: "'/social/accounts/'||r.\"accountId\"",
      where: "r.metric IN ('engagement','engagements')",
      label: "sa.platform::text",
      value: "r.value",
      chart: "line",
      permission: "social",
    },
  );
  add(
    "proposals",
    "marketing",
    "Proposals by outcome",
    "Proposals sent in the period, grouped by current status.",
    {
      ...marketing,
      date: "nullif(r.details->>'sentOn','')::date",
      where: `${marketing.where} AND r.kind='PROPOSAL'`,
      label: "r.status",
      gate: "admin",
      chart: "funnel",
    },
  );
  add(
    "win-rate",
    "marketing",
    "Proposal win rate",
    "Won / (won + declined). Pending and withdrawn proposals stay outside the denominator.",
    {
      ...marketing,
      date: "nullif(r.details->>'sentOn','')::date",
      where: `${marketing.where} AND r.kind='PROPOSAL' AND r.status IN ('WON','DECLINED')`,
      label: "r.status",
      value: "CASE WHEN r.status='WON' THEN 1 ELSE 0 END",
      base: "1",
      unit: "percent",
      mode: "rate",
      gate: "admin",
      chart: "donut",
    },
  );
  add(
    "pipeline",
    "marketing",
    "Proposal pipeline value",
    "Open sent/follow-up proposals, currency separated. This is not added to the CRM deal pipeline or forecast.",
    {
      ...marketing,
      date: "nullif(r.details->>'sentOn','')::date",
      where: `${marketing.where} AND r.kind='PROPOSAL' AND r.status IN ('SENT','FOLLOW_UP')`,
      label: "r.status",
      value: "coalesce((r.details->>'amountMinor')::numeric,0)",
      unit: "money",
      gate: "admin",
      snapshot: true,
    },
  );
}
