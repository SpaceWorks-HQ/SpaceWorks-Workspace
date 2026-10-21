import "server-only";
import type { DefinitionRegistry } from "./registry";
import { funding, product, task, marketing } from "./sources";

export function registerCrossArea({ defs, add }: DefinitionRegistry) {
  add(
    "retention",
    "funding",
    "Donor retention",
    "Retained donors / previous-period donors. Cohorts use unique non-anonymous cash donors in equal-length adjacent periods; new, retained and lapsed groups show their record counts.",
    {
      ...funding,
      date: 'r."dateOn"',
      snapshot: true,
      label: "'Cohort'",
      unit: "percent",
      mode: "rate",
    },
  );
  add(
    "safeguarding",
    "operations",
    "Assigned safeguarding cases",
    "Only cases assigned to you with a current committee appointment. Counts and statuses only; case contents never enter analytics or report packs.",
    {
      table: '"SafeguardingCase" r',
      date: 'r."receivedOn"',
      dateOnly: true,
      titleSql: "'Assigned case '||r.number",
      path: "'/safeguarding/'||r.id",
      label: "r.status",
      permission: "safeguarding",
    },
  );
  add(
    "bom",
    "funding",
    "BOM estimates against linked funding",
    "Latest saved estimate including per-line rounding, tax and contingency / the linked award amount. This is award coverage, not a second income entry.",
    {
      ...product,
      gate: "admin",
      snapshot: true,
      where: `${product.where} AND r.kind='ESTIMATE'`,
      join: `${product.join} JOIN "ProductEstimateRevision" rev ON rev."workspaceId"=r."workspaceId" AND rev."recordId"=r.id AND rev.version=r.revision LEFT JOIN "FundingRecord" award ON award."workspaceId"=r."workspaceId" AND award.id=r."fundingId" AND award.currency=r.currency LEFT JOIN LATERAL (SELECT sum(round((l->>'quantityMilli')::numeric*(l->>'unitCostMinor')::numeric/1000)+round(round((l->>'quantityMilli')::numeric*(l->>'unitCostMinor')::numeric/1000)*(l->>'gstBps')::numeric/10000)) AS subtotal FROM jsonb_array_elements(rev.snapshot->'details'->'lines') l) est ON TRUE`,
      value: `coalesce(est.subtotal,0)+round(coalesce(est.subtotal,0)*coalesce((rev.snapshot->'details'->>'contingencyBps')::numeric,0)/10000)`,
      base: `coalesce(CASE WHEN award.kind='OPPORTUNITY' THEN (award.details->>'awardedMinor')::numeric ELSE award."amountMinor" END,0)`,
      basisUnit: "money",
      label: "r.title",
      unit: "percent",
      mode: "rate",
    },
  );
  // Cross-area registers retain their own source facts rather than posting analytics rows.
  add(
    "actions",
    "work",
    "Meeting action completion",
    "Tasks linked to meetings, due in the period, using the task source permissions.",
    {
      ...task,
      date: 'r."dueAt"',
      where: `${task.where} AND r."sourceMeetingId" IS NOT NULL`,
      label: "coalesce(p.name,'Meeting actions')",
      value: 'CASE WHEN r."completedAt" IS NOT NULL THEN 1 ELSE 0 END',
      base: "1",
      unit: "percent",
      mode: "rate",
    },
  );
  defs.push({
    ...defs.find((d) => d.id === "bom")!,
    id: "bom-received",
    title: "BOM estimates against funds received",
    description:
      "Estimated cost / linked opportunity received summary, or received grant instalments. Donor gifts are not added a second time. This is funding-record evidence, not ledger cash.",
    base: `CASE WHEN award.kind='OPPORTUNITY' THEN coalesce((award.details->>'receivedMinor')::numeric,0) ELSE coalesce((SELECT sum(inst."amountMinor") FROM "FundingRecord" inst WHERE inst."workspaceId"=r."workspaceId" AND inst."parentId"=award.id AND inst.kind='INSTALMENT' AND inst.status='RECEIVED' AND inst."archivedAt" IS NULL AND inst.currency=r.currency),0) END`,
  });
  add(
    "leave",
    "people",
    "Approved leave days by type",
    "Approved availability requests starting in the period; inclusive calendar days, not payroll days. Cancelled requests and missing availability records are excluded.",
    {
      table: '"ChecklistRun" r',
      join: `JOIN LATERAL (SELECT CASE WHEN pg_input_is_valid(coalesce(i."descriptionMd",''),'jsonb') THEN i."descriptionMd"::jsonb ELSE '{}'::jsonb END AS data FROM "ChecklistRunItem" i WHERE i."runId"=r.id AND i."sourceType"='availability_request' ORDER BY i.id LIMIT 1) req ON TRUE LEFT JOIN "LeaveType" lt ON lt.id=req.data->>'leaveTypeId' AND lt."workspaceId"=r."workspaceId"`,
      date: "CASE WHEN pg_input_is_valid(req.data->>'from','date') THEN (req.data->>'from')::date ELSE NULL END",
      dateOnly: true,
      titleSql: "r.title",
      path: "'/leave'",
      where: `r.status='DONE' AND coalesce(req.data->>'type','AWAY')='AWAY'`,
      label: "coalesce(lt.name,'Leave')",
      value:
        "CASE WHEN pg_input_is_valid(req.data->>'from','date') AND pg_input_is_valid(req.data->>'to','date') THEN greatest(0,(req.data->>'to')::date-(req.data->>'from')::date+1) ELSE 0 END",
      unit: "days",
      gate: "admin",
    },
  );
  add(
    "campaigns",
    "funding",
    "Campaigns against goal",
    "Received cash gifts tagged to a campaign / campaign goal. Current lifetime campaign totals; currencies must match.",
    {
      ...funding,
      date: 'r."createdAt"',
      dateOnly: false,
      snapshot: true,
      where: `${funding.where} AND r.kind='CAMPAIGN'`,
      label: "r.title",
      value: `coalesce((SELECT sum(g."amountMinor") FROM "FundingRecord" g WHERE g."workspaceId"=r."workspaceId" AND g.kind='DONATION' AND g.status='RECEIVED' AND g."archivedAt" IS NULL AND g.currency=r.currency AND g.details->>'campaignId'=r.id AND coalesce(g.details->>'mode','')<>'IN_KIND'),0)`,
      base: 'r."amountMinor"',
      basisUnit: "money",
      unit: "percent",
      mode: "rate",
      chart: "stacked",
    },
  );
  add(
    "impact",
    "funding",
    "Impact entries recorded",
    "Manual programme evidence, grouped by KPI. Different KPI units are never added together as outcomes; this metric counts entries.",
    {
      ...funding,
      date: 'r."dateOn"',
      where: `${funding.where} AND r.kind='IMPACT_ENTRY'`,
      label: 'r."parentId"',
    },
  );
  add(
    "impact-progress",
    "funding",
    "Programme KPI progress",
    "Mean of individual KPI target percentages; unlike units are normalised, not added as outcomes. Each KPI uses its existing SUM or LATEST entry rule. This is current progress, not a historical snapshot.",
    {
      ...funding,
      date: 'r."createdAt"',
      dateOnly: false,
      snapshot: true,
      where: `${funding.where} AND r.kind='KPI' AND (r.details->>'target')::numeric>0`,
      label: "r.title",
      value: `100 * coalesce(CASE WHEN r.details->>'aggregation'='LATEST' THEN (SELECT (entry.details->>'value')::numeric FROM "FundingRecord" entry WHERE entry."workspaceId"=r."workspaceId" AND entry."parentId"=r.id AND entry.kind='IMPACT_ENTRY' AND entry."archivedAt" IS NULL ORDER BY entry."dateOn" DESC,entry.id ASC LIMIT 1) ELSE (SELECT sum((entry.details->>'value')::numeric) FROM "FundingRecord" entry WHERE entry."workspaceId"=r."workspaceId" AND entry."parentId"=r.id AND entry.kind='IMPACT_ENTRY' AND entry."archivedAt" IS NULL) END,0) / nullif((r.details->>'target')::numeric,0)`,
      base: "1",
      unit: "percent",
      mode: "average",
      dimensions: { programme: 'r."parentId"' },
    },
  );
  add(
    "grant-utilisation",
    "funding",
    "Grant fund utilisation",
    "Lifetime non-void expenses / income on grant-linked restricted funds. Grants sharing a fund are shown once per fund. Funding receipts do not post the ledger.",
    {
      table: '"FinanceFund" r',
      date: 'r."createdAt"',
      titleSql: "r.name",
      path: "'/finance/funds?record='||r.id||'#'||r.id",
      where: `r.restricted AND r."archivedAt" IS NULL AND EXISTS(SELECT 1 FROM "FundingRecord" g WHERE g."workspaceId"=r."workspaceId" AND g.kind='GRANT' AND g."fundId"=r.id AND g."archivedAt" IS NULL)`,
      label: "r.name",
      value: `coalesce((SELECT sum(e."amountMinor") FROM "LedgerEntry" e WHERE e."workspaceId"=r."workspaceId" AND e."fundId"=r.id AND e.currency=r.currency AND e.kind='EXPENSE' AND e."voidedAt" IS NULL),0)`,
      base: `coalesce((SELECT sum(e."amountMinor") FROM "LedgerEntry" e WHERE e."workspaceId"=r."workspaceId" AND e."fundId"=r.id AND e.currency=r.currency AND e.kind='INCOME' AND e."voidedAt" IS NULL),0)`,
      basisUnit: "money",
      snapshot: true,
      mode: "rate",
      unit: "percent",
      gate: "admin",
      dimensions: { fund: "r.id" },
    },
  );
  add(
    "documents",
    "finance",
    "Controlled documents issued",
    "Issued financial documents by type, excluding payroll. Their totals are not added to ledger income or expenditure.",
    {
      table: '"BusinessDocument" r',
      date: 'r."issuedOn"',
      dateOnly: true,
      titleSql: "coalesce(r.number,r.title)",
      path: "'/documents/'||r.id",
      where: `r.status='ISSUED' AND coalesce(r."sourceType",'')<>'PAY_RUN'`,
      label: "r.type",
      value: 'r."totalMinor"',
      unit: "money",
      gate: "admin",
    },
  );
  add(
    "requests",
    "finance",
    "Open purchase commitments",
    "Submitted/approved purchase requests; shown separately from forecast bills to avoid counting a request and its bill twice.",
    {
      table: '"PurchaseRequest" r',
      date: 'r."createdAt"',
      titleSql: "r.title",
      path: "'/requests#'||r.id",
      where: `r.status IN ('SUBMITTED','APPROVED')`,
      label: "r.status::text",
      value: 'r."totalMinor"',
      unit: "money",
      gate: "admin",
      snapshot: true,
      dimensions: { team: 'r."teamId"', project: 'r."projectId"' },
    },
  );
  add(
    "reimbursements",
    "finance",
    "Approved unpaid claims",
    "Approved reimbursement claims, separate from posted ledger expenses.",
    {
      table: '"Reimbursement" r',
      date: 'r."createdAt"',
      titleSql: "'Expense claim'",
      path: "'/requests#'||r.id",
      where: `r.status='APPROVED'`,
      label: "r.status::text",
      value: 'r."totalMinor"',
      unit: "money",
      gate: "admin",
      snapshot: true,
      dimensions: { team: 'r."teamId"' },
    },
  );
  add(
    "knowledge",
    "operations",
    "Knowledge verification due",
    "Docs whose verification expires in the selected period. Admin-only documents retain their source gate.",
    {
      table: '"Doc" r',
      date: 'r."verifiedUntil"',
      titleSql: "r.title",
      path: "'/docs/'||r.id",
      label: "r.visibility::text",
      where: `r."archivedAt" IS NULL`,
      permission: "content",
    },
  );
  add(
    "responsibilities",
    "operations",
    "Responsibility reviews due",
    "Active RACI responsibilities due for a review in the period.",
    {
      table: '"Responsibility" r',
      date: 'r."reviewOn"',
      dateOnly: true,
      titleSql: "r.title",
      path: "'/responsibilities?edit='||r.id",
      label: "r.status",
      where: `r.status='ACTIVE'`,
    },
  );
  add(
    "restore-tests",
    "operations",
    "Recovery tests",
    "Manual restore tests by recorded outcome, not proof of production recoverability.",
    {
      ...marketing,
      where: `${marketing.where} AND r.kind='RESTORE'`,
      label: "r.status",
      gate: "admin",
    },
  );
}
