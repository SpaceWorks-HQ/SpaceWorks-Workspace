import "server-only";
import type { DefinitionRegistry } from "./registry";
import { funding } from "./sources";

export function registerFunding({ add }: DefinitionRegistry) {
  add(
    "donations",
    "funding",
    "Donations received",
    "Received cash gifts; in-kind gifts stay outside money totals. Saving a gift does not post the ledger.",
    {
      ...funding,
      join: `LEFT JOIN "FundingRecord" campaign ON campaign."workspaceId"=r."workspaceId" AND campaign.id=r.details->>'campaignId'`,
      where: `${funding.where} AND r.kind='DONATION' AND r.status='RECEIVED' AND coalesce(r.details->>'mode','')<>'IN_KIND'`,
      label: "coalesce(campaign.title,'Unassigned')",
      value: 'r."amountMinor"',
      unit: "money",
      chart: "line",
    },
  );
  add(
    "average-gift",
    "funding",
    "Average cash gift",
    "Received cash amount divided by received cash gifts.",
    {
      ...funding,
      where: `${funding.where} AND r.kind='DONATION' AND r.status='RECEIVED' AND coalesce(r.details->>'mode','')<>'IN_KIND'`,
      label: "coalesce(r.details->>'mode','Not recorded')",
      value: 'r."amountMinor"',
      base: "1",
      mode: "average",
      unit: "money",
    },
  );
  add(
    "top-donors",
    "funding",
    "Top donors",
    "Donor identity is restricted to funding administrators. Anonymous gifts have their own group.",
    {
      ...funding,
      join: 'LEFT JOIN "Contact" c ON c.id=r."contactId" AND c."workspaceId"=r."workspaceId" AND c."deletedAt" IS NULL',
      where: `${funding.where} AND r.kind='DONATION' AND r.status='RECEIVED' AND coalesce(r.details->>'mode','')<>'IN_KIND'`,
      label: "coalesce(c.\"displayName\",'Anonymous')",
      value: 'r."amountMinor"',
      unit: "money",
    },
  );
  add(
    "grant-pipeline",
    "funding",
    "Grant pipeline value",
    "Current opportunity stage with requested value before award and awarded value afterwards; not probability-weighted income.",
    {
      ...funding,
      date: 'r."createdAt"',
      dateOnly: false,
      where: `${funding.where} AND r.kind='OPPORTUNITY'`,
      label: "r.status",
      value:
        "CASE WHEN r.status IN ('AWARDED','RECEIVING','REPORTING','CLOSED') THEN coalesce((r.details->>'awardedMinor')::numeric,0) ELSE coalesce((r.details->>'askedMinor')::numeric,0) END",
      unit: "money",
      snapshot: true,
      chart: "funnel",
    },
  );
  add(
    "grant-reports",
    "funding",
    "Grant reports due",
    "Incomplete report and deliverable deadlines in the selected period.",
    {
      ...funding,
      date: 'r."dueOn"',
      where: `${funding.where} AND r.kind IN ('REPORT','DELIVERABLE') AND r.status<>'DONE'`,
      label: "r.kind::text",
    },
  );
  add(
    "grant-instalments",
    "funding",
    "Expected grant instalments",
    "Unreceived instalments in the selected period. Estimates, not booked income.",
    {
      ...funding,
      date: 'r."dueOn"',
      where: `${funding.where} AND r.kind='INSTALMENT' AND r.status='EXPECTED'`,
      label: "'Expected'",
      value: 'r."amountMinor"',
      unit: "money",
    },
  );
}
