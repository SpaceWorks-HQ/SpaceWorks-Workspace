import "server-only";
import type { DefinitionRegistry } from "./registry";

export function registerGovernance({ add }: DefinitionRegistry) {
  const gov = {
    table: '"GovernanceRecord" r',
    date: 'r."dueOn"',
    dateOnly: true,
    titleSql: "r.title",
    path: "'/governance'||CASE r.kind WHEN 'RISK' THEN '/risk' WHEN 'CONTRACT' THEN '/vendors' ELSE '' END||'?edit='||r.id",
    gate: "admin" as const,
    where: 'r."archivedAt" IS NULL',
  };
  add(
    "compliance",
    "operations",
    "Compliance completion",
    "Filed or done obligations due in the period. Exact on-time vs late completion cannot be established: this register has no completion timestamp.",
    {
      ...gov,
      where: `${gov.where} AND r.kind='OBLIGATION'`,
      label: "r.status",
      value: "CASE WHEN r.status IN ('FILED','DONE') THEN 1 ELSE 0 END",
      base: "1",
      unit: "percent",
      mode: "rate",
    },
  );
  add(
    "risks",
    "operations",
    "Open risks by rating",
    "Current open risk register, using recorded risk ratings.",
    {
      ...gov,
      date: 'r."createdAt"',
      dateOnly: false,
      snapshot: true,
      where: `${gov.where} AND r.kind='RISK' AND r.status NOT IN ('CLOSED','ARCHIVED')`,
      label:
        "CASE WHEN (r.details->>'likelihood')::int*(r.details->>'impact')::int>=15 THEN 'High' WHEN (r.details->>'likelihood')::int*(r.details->>'impact')::int>=6 THEN 'Medium' ELSE 'Low' END",
    },
  );
  add(
    "contracts",
    "operations",
    "Contracts renewing",
    "Contract expiry dates in the selected period.",
    {
      ...gov,
      date: 'r."endsOn"',
      where: `${gov.where} AND r.kind='CONTRACT'`,
      label: "r.status",
    },
  );
  add(
    "subscriptions",
    "operations",
    "Subscriptions renewing",
    "Active subscriptions with a renewal date in the selected period; private-team scope is preserved.",
    {
      table: '"Subscription" r',
      date: 'r."nextRenewalAt"',
      titleSql: "r.name",
      path: "'/subscriptions#'||r.id",
      where: "r.status='ACTIVE'",
      label: "r.kind::text",
      permission: "project",
      dimensions: { team: 'r."teamId"' },
    },
  );
}
