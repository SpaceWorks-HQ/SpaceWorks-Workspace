import "server-only";
import { localDate } from "@/lib/finance/dates";
import { fromDateInputValue } from "@/lib/tasks/localDate";
import { addDays } from "./metrics";
import { budgetActualSql } from "@/lib/finance/reportMetrics";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { meetingWhere } from "@/lib/meetings/service";
import type { Access } from "./access";
import type { Unit, ChartKind, Section, Period, AnalyticsQuery } from "./types";
export type Definition = {
  id: string;
  section: Section;
  title: string;
  description: string;
  unit: Unit;
  basisUnit?: Unit;
  chart: ChartKind;
  mode: "sum" | "rate" | "average";
  snapshot?: boolean;
  gate?: "admin" | "finance" | "payroll";
  table: string;
  join?: string;
  date: string;
  eligibilityDate?: string;
  titleSql: string;
  path: string;
  label?: string;
  value?: string;
  base?: string;
  where?: string;
  dimensions?: Partial<
    Record<"fund" | "centre" | "team" | "project" | "programme", string>
  >;
  permission?:
    | "task"
    | "project"
    | "help"
    | "safety"
    | "volunteer"
    | "attendance"
    | "meeting"
    | "content"
    | "social"
    | "service"
    | "safeguarding";
  dateOnly?: boolean;
  person?: string;
};
const ledgerDims = {
  fund: 'r."fundId"',
  centre: 'r."costCentreId"',
  project: 'c."projectId"',
  team: 'p."teamId"',
};
const ledger = {
  table: '"LedgerEntry" r',
  join: 'LEFT JOIN "FinanceCategory" k ON k.id=r."categoryId" AND k."workspaceId"=r."workspaceId" LEFT JOIN "FinanceFund" f ON f.id=r."fundId" AND f."workspaceId"=r."workspaceId" LEFT JOIN "FinanceCostCentre" c ON c.id=r."costCentreId" AND c."workspaceId"=r."workspaceId" LEFT JOIN "Project" p ON p.id=c."projectId" AND p."workspaceId"=r."workspaceId"',
  date: 'r."occurredOn"',
  dateOnly: true,
  titleSql: "r.description",
  path: "'/finance/ledger?record='||r.id",
  unit: "money" as const,
  gate: "finance" as const,
  where: 'r."voidedAt" IS NULL AND NOT r."privatePayroll"',
  value: 'r."amountMinor"',
  dimensions: ledgerDims,
};
const funding = {
  table: '"FundingRecord" r',
  date: 'r."dateOn"',
  dateOnly: true,
  titleSql: "r.title",
  path: "'/funding/'||CASE WHEN r.kind IN ('OPPORTUNITY') THEN 'tracker' WHEN r.kind IN ('DONATION','DONOR','CAMPAIGN','PLEDGE','RECEIPT_SETTINGS') THEN 'donations' WHEN r.kind IN ('PROGRAMME','KPI','IMPACT_ENTRY') THEN 'impact' ELSE 'grants' END||'?edit='||r.id",
  gate: "admin" as const,
  where: 'r."archivedAt" IS NULL',
  dimensions: {
    fund: 'coalesce(r."fundId",(SELECT parent."fundId" FROM "FundingRecord" parent WHERE parent."workspaceId"=r."workspaceId" AND parent.id=r."parentId"))',
    programme: `coalesce(nullif(r.details->>'programmeId',''),(SELECT CASE WHEN parent.kind='PROGRAMME' THEN parent.id ELSE nullif(parent.details->>'programmeId','') END FROM "FundingRecord" parent WHERE parent."workspaceId"=r."workspaceId" AND parent.id=r."parentId"),(SELECT programme.id FROM "FundingRecord" parent JOIN "FundingRecord" programme ON programme.id=parent."parentId" AND programme."workspaceId"=parent."workspaceId" WHERE parent."workspaceId"=r."workspaceId" AND parent.id=r."parentId" AND programme.kind='PROGRAMME'))`,
  },
};
const people = {
  table: `(SELECT mb.id,mb."workspaceId",mb."userId",mp."engagementStart",mp."leavingAt",mp."departmentId",coalesce(mp."membershipType"::text,'Not recorded') AS "membershipType",coalesce(mp."engagementType",'Not recorded') AS "engagementType",mb."joinedAt" AS "createdAt" FROM "Membership" mb LEFT JOIN "MemberProfile" mp ON mp."workspaceId"=mb."workspaceId" AND mp."userId"=mb."userId") r`,
  join: 'JOIN "Membership" m ON m."workspaceId"=r."workspaceId" AND m."userId"=r."userId" JOIN "User" u ON u.id=r."userId" LEFT JOIN "Department" dep ON dep.id=r."departmentId" AND dep."workspaceId"=r."workspaceId"',
  date: 'r."engagementStart"',
  dateOnly: true,
  titleSql: "coalesce(u.name,'Former member')",
  path: "'/members/'||r.\"userId\"",
  person: 'r."userId"',
  dimensions: { team: "NULL::text" },
};
const task = {
  table: '"Task" r',
  join: 'LEFT JOIN "Project" p ON p.id=r."projectId" AND p."workspaceId"=r."workspaceId"',
  date: 'r."createdAt"',
  titleSql: "r.title",
  path: "CASE WHEN p.key IS NULL THEN '/my-tasks/'||r.number ELSE '/projects/'||p.key||'/tasks/'||r.number END",
  where: 'r."archivedAt" IS NULL',
  permission: "task" as const,
  dimensions: { project: 'r."projectId"', team: 'p."teamId"' },
};
const product = {
  table: '"ProductRecord" r',
  join: 'LEFT JOIN "Project" p ON p.id=r."projectId" AND p."workspaceId"=r."workspaceId"',
  date: 'r."createdAt"',
  titleSql: "r.title",
  path: "'/product-ops/'||CASE r.kind WHEN 'ISSUE' THEN 'issues' WHEN 'RELEASE' THEN 'releases' ELSE 'estimates' END||'?edit='||r.id",
  where: 'r."archivedAt" IS NULL AND (r."projectId" IS NULL OR p.status<>\'ARCHIVED\')',
  dimensions: {
    project: 'r."projectId"',
    team: 'p."teamId"',
    fund: 'r."fundId"',
  },
  permission: "project" as const,
};
const help = {
  table: '"HelpTicket" r',
  date: 'r."createdAt"',
  titleSql: "r.title",
  path: "'/helpdesk/'||r.id",
  permission: "help" as const,
  label: "r.priority::text",
};
const marketing = {
  table: '"MarketingItRecord" r',
  date: 'r."dateOn"',
  dateOnly: true,
  titleSql: "r.title",
  path: "CASE WHEN r.kind IN ('CONTENT','PROPOSAL') THEN '/marketing' ELSE '/it' END||'?tool='||r.kind||'&edit='||r.id",
  where: 'r."archivedAt" IS NULL',
};
const defs: Definition[] = [];
function add(
  id: string,
  section: Section,
  title: string,
  description: string,
  data: Omit<
    Definition,
    "id" | "section" | "title" | "description" | "unit" | "chart" | "mode"
  > &
    Partial<Pick<Definition, "unit" | "chart" | "mode">>,
) {
  defs.push({
    id,
    section,
    title,
    description,
    unit: "count",
    chart: "bar",
    mode: "sum",
    ...data,
  });
}
for (const [id, title, label, kind] of [
  ["income", "Income by source", 'r."incomeSource"', "INCOME"],
  [
    "income-funder",
    "Income by donor or funder",
    "coalesce(r.counterparty,'Not recorded')",
    "INCOME",
  ],
  [
    "spending",
    "Spending by category",
    "coalesce(k.name,'Uncategorised')",
    "EXPENSE",
  ],
  [
    "vendors",
    "Spending by vendor",
    "coalesce(r.counterparty,'Not recorded')",
    "EXPENSE",
  ],
  ["funds", "Spending by fund", "coalesce(f.name,'Unassigned')", "EXPENSE"],
  [
    "centres",
    "Programme, event and project spending",
    "coalesce(c.name,'Unassigned')",
    "EXPENSE",
  ],
] as const)
  add(
    id,
    "finance",
    title,
    "Posted, non-void ledger entries. Private payroll is excluded, matching Finance reports.",
    { ...ledger, label, where: `${ledger.where} AND r.kind='${kind}'` },
  );
add(
  "statement",
  "finance",
  "Programme and project net statement",
  "Income less expenses by existing cost centre. Private payroll is excluded, matching Finance statements.",
  {
    ...ledger,
    value: `r."amountMinor" * CASE WHEN r.kind='INCOME' THEN 1 ELSE -1 END`,
    label: "coalesce(c.name,'Unassigned')",
  },
);
add(
  "gst",
  "finance",
  "GST components",
  "Recorded ledger tax, not a filing or cash deposit statement.",
  {
    ...ledger,
    value: 'r."cgstMinor"+r."sgstMinor"+r."igstMinor"',
    label: "r.kind::text",
  },
);
for (const [id, title, field] of [
  ["cgst", "CGST recorded", "cgstMinor"],
  ["sgst", "SGST recorded", "sgstMinor"],
  ["igst", "IGST recorded", "igstMinor"],
] as const)
  add(
    id,
    "finance",
    title,
    "Recorded ledger tax component, grouped by income/expense. This is not a tax-credit eligibility or filing calculation.",
    { ...ledger, value: `r."${field}"`, label: "r.kind::text" },
  );
add(
  "tds",
  "finance",
  "Withholding recorded",
  "Ledger TDS only; deductions are not cash payments.",
  { ...ledger, value: 'r."tdsMinor"', label: "r.kind::text" },
);
add(
  "payroll",
  "finance",
  "Payroll paid",
  "Net paid by pay month; explicit payroll access required.",
  {
    table: '"FinancePayRun" r',
    date: 'r."paidOn"',
    dateOnly: true,
    titleSql: "'Pay run '||r.month",
    path: "'/finance/payroll?month='||r.month||'#'||r.id",
    label: "r.month",
    where: "r.status='PAID'",
    value: 'r."netMinor"',
    gate: "payroll",
    unit: "money",
    dimensions: { fund: 'r."fundId"', centre: 'r."costCentreId"' },
  },
);
defs.push({
  ...defs.find((d) => d.id === "payroll")!,
  id: "payroll-gross",
  title: "Gross payroll paid",
  description:
    "Gross pay plus entered allowances for paid runs. Explicit payroll access is required.",
  value: 'r."grossMinor"+r."allowancesMinor"',
});
defs.push({
  ...defs.find((d) => d.id === "payroll")!,
  id: "payroll-deductions",
  title: "Statutory payroll deductions",
  description:
    "Recorded PF, ESI, professional tax and salary TDS deductions on paid runs, before remittance. Explicit payroll access is required.",
  value: 'r."pfMinor"+r."esiMinor"+r."ptMinor"+r."tdsMinor"',
});
add(
  "remittances",
  "finance",
  "Payroll remittances outstanding",
  "Unpaid statutory bills; explicit payroll access required.",
  {
    table: '"FinanceBill" r',
    date: 'r."dueOn"',
    dateOnly: true,
    titleSql: "r.vendor",
    path: "'/finance/payroll/dues'",
    value: 'r."amountMinor"-r."paidMinor"',
    where: 'r."privatePayroll" AND r."paidMinor"<r."amountMinor"',
    gate: "payroll",
    unit: "money",
    snapshot: true,
    dimensions: { fund: 'r."fundId"', centre: 'r."costCentreId"' },
  },
);
add(
  "payables",
  "finance",
  "Payables ageing",
  "Outstanding supplier bills at the reporting end. Current balances, including later payments; not a historical reconstruction.",
  {
    table: '"FinanceBill" r',
    eligibilityDate: 'r."issuedOn"',
    date: 'r."dueOn"',
    dateOnly: true,
    titleSql: "r.vendor||' · '||r.number",
    path: "'/finance/bills?record='||r.id",
    value: 'r."amountMinor"-r."paidMinor"',
    where: 'NOT r."privatePayroll" AND r."paidMinor"<r."amountMinor"',
    gate: "finance",
    unit: "money",
    snapshot: true,
    label: "ageing",
    dimensions: { fund: 'r."fundId"', centre: 'r."costCentreId"' },
  },
);
add(
  "receivables",
  "finance",
  "Legacy receivables ageing",
  "Sent legacy invoices. Controlled Documents balances are a separate metric to avoid double-counting linked source invoices.",
  {
    table: '"Invoice" r',
    eligibilityDate: 'r."issuedOn"',
    date: 'coalesce(r."dueOn",r."issuedOn")',
    dateOnly: true,
    titleSql: "r.number||' · '||r.\"clientName\"",
    path: "'/finance/invoices/'||r.id",
    value: 'r."totalMinor"',
    where: "r.status='SENT'",
    gate: "finance",
    unit: "money",
    snapshot: true,
    label: "ageing",
  },
);
const controlledBalance = `greatest(0,r."totalMinor"-coalesce((SELECT sum(a."cashMinor"+a."tdsMinor") FROM "DocumentAllocation" a WHERE a."workspaceId"=r."workspaceId" AND a."invoiceId"=r.id),0)
 +coalesce((SELECT sum((allocation->>'cashMinor')::bigint) FROM "BusinessDocument" refund CROSS JOIN LATERAL jsonb_array_elements(coalesce(refund.snapshot->'source'->'refundAllocations','[]'::jsonb)) allocation WHERE refund."workspaceId"=r."workspaceId" AND refund.status='ISSUED' AND refund.type IN ('PAYMENT_REFUND','REFUND_VOUCHER') AND allocation->>'invoiceId'=r.id),0)
 -coalesce((SELECT sum((allocation->>'amountMinor')::bigint) FROM "BusinessDocument" note CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(note.snapshot->'source'->'noteAllocations')='array' THEN note.snapshot->'source'->'noteAllocations' WHEN note."parentId" IS NOT NULL THEN jsonb_build_array(jsonb_build_object('invoiceId',note."parentId",'amountMinor',note."totalMinor")) ELSE '[]'::jsonb END) allocation WHERE note."workspaceId"=r."workspaceId" AND note.status='ISSUED' AND note.type='CREDIT_NOTE' AND allocation->>'invoiceId'=r.id),0))`;
add(
  "document-receivables",
  "finance",
  "Controlled receivables ageing",
  "Issued Documents invoices less cash, withholding and frozen credit allocations, plus refunded cash allocations. Current outstanding balances; future payments are not reversed to reconstruct history.",
  {
    table: '"BusinessDocument" r',
    eligibilityDate: 'r."issuedOn"',
    date: 'coalesce(r."dueOn",r."issuedOn")',
    dateOnly: true,
    titleSql: "coalesce(r.number,r.title)",
    path: "'/documents/'||r.id",
    where: `r.status='ISSUED' AND coalesce(r."sourceType",'')<>'PAY_RUN' AND r.type IN ('COMMERCIAL_INVOICE','TAX_INVOICE','BILL_OF_SUPPLY','VAT_INVOICE','DEBIT_NOTE') AND ${controlledBalance}>0`,
    value: controlledBalance,
    label: "ageing",
    unit: "money",
    gate: "admin",
    snapshot: true,
  },
);
add(
  "fixed-costs",
  "finance",
  "Fixed and estimated monthly costs",
  "Monthly equivalents of active recurring schedules. Estimates are labelled separately; this is not posted expenditure.",
  {
    table: '"RecurringCostSchedule" r',
    date: 'r."startsOn"',
    dateOnly: true,
    titleSql: "r.title",
    path: "'/finance/recurring?edit='||r.id",
    value:
      "round(r.\"amountMinor\"::numeric / CASE r.frequency WHEN 'YEARLY' THEN 12 WHEN 'QUARTERLY' THEN 3 ELSE 1 END)",
    where: "r.status='ACTIVE'",
    gate: "admin",
    unit: "money",
    snapshot: true,
    label:
      "CASE WHEN r.estimated THEN 'Variable estimate' ELSE 'Fixed commitment' END",
    dimensions: { fund: 'r."fundId"', centre: 'r."costCentreId"' },
  },
);
add(
  "budgets",
  "finance",
  "Budget utilisation",
  "Full budget-period actuals, including private payroll in aggregate, matching Finance budget reports. Select a budget to review its variance.",
  {
    table: '"Budget" r',
    date: 'r."periodStart"',
    dateOnly: true,
    titleSql: "r.name",
    path: "'/finance/budgets?record='||r.id||'#'||r.id",
    value: "0",
    base: 'r."amountMinor"',
    basisUnit: "money",
    unit: "percent",
    mode: "rate",
    snapshot: true,
    gate: "finance",
    label: "r.name",
    dimensions: {
      centre: 'r."costCentreId"',
      project: 'r."projectId"',
      team: 'r."teamId"',
    },
  },
);
add(
  "restricted",
  "finance",
  "Restricted fund spending",
  "Non-payroll expenditure tagged to a restricted fund.",
  {
    ...ledger,
    where: `${ledger.where} AND r.kind='EXPENSE' AND f.restricted`,
    label: "f.name",
    chart: "donut",
  },
);
add(
  "petty-cash",
  "finance",
  "Petty cash vouchers",
  "Posted vouchers, separate from ledger totals; do not add these two views.",
  {
    table: '"MoneyControlRecord" r',
    date: 'r."occurredOn"',
    dateOnly: true,
    titleSql: "r.title",
    path: "'/money-controls/cash?edit='||r.id",
    where: "r.kind='VOUCHER' AND r.status='POSTED' AND NOT r.payroll",
    label: "r.details->>'direction'",
    value: 'r."amountMinor"',
    unit: "money",
    gate: "admin",
    dimensions: { fund: 'r."fundId"' },
  },
);
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
add(
  "headcount",
  "people",
  "Headcount by engagement",
  "Active, enabled people at the selected end date, grouped by engagement. Leavers remain in historical joiner/leaver counts.",
  {
    ...people,
    date: 'coalesce(r."engagementStart",m."joinedAt")',
    snapshot: true,
    label: 'coalesce(nullif(r."engagementType",\'\'),r."membershipType"::text)',
    where:
      'm.status=\'ACTIVE\' AND m.role<>\'GUEST\' AND u."disabledAt" IS NULL AND (r."leavingAt" IS NULL OR r."leavingAt">CURRENT_DATE)',
  },
);
add(
  "departments",
  "people",
  "Headcount by department",
  "Current active people by department; missing assignments are shown.",
  {
    ...people,
    date: 'coalesce(r."engagementStart",m."joinedAt")',
    snapshot: true,
    label: "coalesce(dep.name,'Unassigned')",
    where:
      'm.status=\'ACTIVE\' AND m.role<>\'GUEST\' AND u."disabledAt" IS NULL AND (r."leavingAt" IS NULL OR r."leavingAt">CURRENT_DATE)',
  },
);
add(
  "joiners",
  "people",
  "Joiners",
  "Engagement start date, falling back to membership join date.",
  {
    ...people,
    date: 'coalesce(r."engagementStart",m."joinedAt")',
    label: 'r."engagementType"',
    gate: "admin",
  },
);
add(
  "leavers",
  "people",
  "Leavers",
  "Recorded leaving date. Deleted membership histories cannot be reconstructed.",
  {
    ...people,
    date: 'r."leavingAt"',
    label: 'r."engagementType"',
    gate: "admin",
  },
);
add(
  "attendance",
  "people",
  "Recorded attendance rate",
  "Present/remote = 1, half-day = 0.5, absent = 0. Only recorded non-leave days are the denominator; missing days are not absence. Restricted to self, direct manager or admin.",
  {
    table: '"AttendanceEntry" r',
    date: 'r."dateOn"',
    dateOnly: true,
    titleSql: "'Attendance '||r.\"dateOn\"::text",
    path: "'/attendance?month='||left(r.\"dateOn\"::text,7)",
    label: 'r."dateOn"::text',
    value:
      "CASE r.status WHEN 'PRESENT' THEN 1 WHEN 'REMOTE' THEN 1 WHEN 'HALF_DAY' THEN 0.5 ELSE 0 END",
    base: "1",
    where: "r.status<>'ON_LEAVE'",
    mode: "rate",
    unit: "percent",
    chart: "calendar",
    permission: "attendance",
    person: 'r."userId"',
    dimensions: { team: "NULL::text" },
  },
);
add(
  "hours",
  "people",
  "Approved volunteer hours",
  "Approved manual logs; not rota estimates. Members see their own logs.",
  {
    table: '"VolunteerLog" r',
    join: 'LEFT JOIN "Membership" person_member ON person_member."workspaceId"=r."workspaceId" AND person_member."userId"=r."userId" LEFT JOIN "User" person ON person.id=person_member."userId"',
    date: 'r."startsAt"',
    titleSql: "r.activity",
    path: "'/volunteering/'||r.id",
    where: "r.status='APPROVED'",
    label: "coalesce(person.name,'Former member')",
    value: "r.minutes::numeric/60",
    unit: "hours",
    permission: "volunteer",
    person: 'r."userId"',
    dimensions: { team: "NULL::text" },
  },
);
add(
  "hiring",
  "people",
  "Hiring funnel",
  "Current candidate stage for applications received in the period.",
  {
    table: '"HiringCandidate" r',
    date: 'r."createdAt"',
    titleSql: "r.name",
    path: "'/hiring/'||r.id",
    label: "r.stage",
    gate: "admin",
    chart: "funnel",
  },
);
add(
  "time-to-hire",
  "people",
  "Time to hire",
  "Days from application to linked onboarding creation. Missing onboarding dates are excluded; updated timestamps are not treated as hiring dates.",
  {
    table: '"HiringCandidate" r',
    join: 'JOIN "ChecklistRun" h ON h.id=r."onboardingRunId" AND h."workspaceId"=r."workspaceId"',
    date: 'h."createdAt"',
    titleSql: "r.name",
    path: "'/hiring/'||r.id",
    label: 'r."openingId"',
    value: 'greatest(0,extract(epoch from(h."createdAt"-r."createdAt"))/86400)',
    base: "1",
    unit: "days",
    mode: "average",
    gate: "admin",
  },
);
add(
  "certifications",
  "people",
  "Certification expiry",
  "Unrevoked certifications expiring in the period. Training evidence stays in People.",
  {
    table:
      '(SELECT cr.*, ct."workspaceId" FROM "Certification" cr JOIN "CertType" ct ON ct.id=cr."certTypeId") r',
    join: 'JOIN "CertType" ct ON ct.id=r."certTypeId" AND ct."workspaceId"=r."workspaceId"',
    date: 'r."expiresAt"',
    titleSql: "ct.name",
    path: "'/members/'||r.\"userId\"",
    label: "ct.name",
    where: 'r."revokedAt" IS NULL AND EXISTS(SELECT 1 FROM "Membership" cert_member WHERE cert_member."workspaceId"=r."workspaceId" AND cert_member."userId"=r."userId" AND cert_member.status=\'ACTIVE\')',
  },
);
add(
  "tasks-created",
  "work",
  "Tasks created",
  "Visible, non-archived tasks created in the period.",
  { ...task, label: "coalesce(p.name,'Personal tasks')", chart: "line" },
);
add(
  "tasks-completed",
  "work",
  "Tasks completed",
  "Visible tasks completed in the period. Current completion state; reopened tasks are excluded.",
  {
    ...task,
    date: 'r."completedAt"',
    label: "coalesce(p.name,'Personal tasks')",
    chart: "line",
  },
);
add(
  "overdue-tasks",
  "work",
  "Overdue tasks",
  "Open tasks overdue at the report end; current state, not historical state reconstruction.",
  {
    ...task,
    date: 'r."dueAt"',
    snapshot: true,
    where: `${task.where} AND r."completedAt" IS NULL AND r."dueAt" IS NOT NULL`,
    label: "r.priority::text",
  },
);
add(
  "blockers",
  "work",
  "Blocker age",
  "Age since task creation for currently blocked tasks. The schema has no blocker-start timestamp; task age is explicitly a proxy.",
  {
    ...task,
    snapshot: true,
    label: "ageing",
    value: "0",
    unit: "days",
    mode: "average",
    base: "1",
    where: `${task.where} AND r."completedAt" IS NULL AND (nullif(r."blockerReason",'') IS NOT NULL OR EXISTS(SELECT 1 FROM "TaskDependency" td JOIN "Task" bt ON bt.id=td."blockingTaskId" AND bt."workspaceId"=td."workspaceId" WHERE td."workspaceId"=r."workspaceId" AND td."blockedTaskId"=r.id AND td.type='BLOCKS' AND bt."completedAt" IS NULL AND bt."archivedAt" IS NULL))`,
  },
);
add(
  "project-health",
  "work",
  "Project health",
  "Latest check-in at the report end. Projects without a check-in are labelled Not recorded.",
  {
    table: '"Project" r',
    date: 'r."createdAt"',
    titleSql: "r.name",
    path: "'/projects/'||r.key",
    snapshot: true,
    where: "r.status IN ('ACTIVE','PAUSED')",
    label: "health",
    permission: "project",
    dimensions: { team: 'r."teamId"', project: "r.id" },
  },
);
add(
  "milestones",
  "work",
  "Milestone completion rate",
  "Milestones due in the period, complete manually or when every linked task is complete. Target dates are not actual completion timestamps, so this does not claim an on-time hit rate.",
  {
    table: '"ProjectMilestone" r',
    join: 'JOIN "Project" p ON p.id=r."projectId" AND p."workspaceId"=r."workspaceId"',
    date: 'r."targetOn"',
    dateOnly: true,
    titleSql: "r.name",
    path: "'/projects/'||p.key||'/overview'",
    label: "p.name",
    value:
      'CASE WHEN r.status=\'DONE\' OR (EXISTS(SELECT 1 FROM "ProjectMilestoneTask" mt WHERE mt."workspaceId"=r."workspaceId" AND mt."milestoneId"=r.id) AND NOT EXISTS(SELECT 1 FROM "ProjectMilestoneTask" mt JOIN "Task" t ON t.id=mt."taskId" AND t."workspaceId"=mt."workspaceId" WHERE mt."workspaceId"=r."workspaceId" AND mt."milestoneId"=r.id AND t."completedAt" IS NULL)) THEN 1 ELSE 0 END',
    base: "1",
    unit: "percent",
    mode: "rate",
    permission: "project",
    dimensions: { project: 'r."projectId"', team: 'p."teamId"' },
  },
);
add(
  "releases",
  "work",
  "Releases shipped",
  "Shipped date of recorded releases; no external connector.",
  {
    ...product,
    date: 'r."shippedAt"',
    where: `${product.where} AND r.kind='RELEASE' AND r.status='SHIPPED'`,
    label: "coalesce(p.name,'Unassigned')",
    chart: "line",
  },
);
add(
  "bugs-opened",
  "work",
  "Bugs opened by severity",
  "Bug records created in the period.",
  {
    ...product,
    where: `${product.where} AND r.kind='ISSUE' AND r.details->>'type'='BUG'`,
    label: "coalesce(r.details->>'severity','Not recorded')",
  },
);
add(
  "bugs-closed",
  "work",
  "Bugs currently resolved",
  "Resolved or closed bugs last updated in the period. No separate resolution timestamp exists; this is an update-date proxy.",
  {
    ...product,
    date: 'r."updatedAt"',
    where: `${product.where} AND r.kind='ISSUE' AND r.details->>'type'='BUG' AND r.status IN ('RESOLVED','CLOSED')`,
    label: "coalesce(r.details->>'severity','Not recorded')",
  },
);
add(
  "meeting-load",
  "work",
  "Meeting hours",
  "Scheduled duration of visible, non-cancelled meetings, not attendee-hours.",
  {
    table: '"Meeting" r',
    date: 'r."startsAt"',
    titleSql: "r.title",
    path: "'/meetings/'||r.id",
    where: "r.status<>'CANCELLED' AND r.\"endsAt\" IS NOT NULL",
    value: 'greatest(0,extract(epoch from(r."endsAt"-r."startsAt"))/3600)',
    label: "'Meeting hours'",
    unit: "hours",
    permission: "meeting",
    dimensions: { team: 'r."teamId"', project: 'r."projectId"' },
  },
);
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
    "Current internal register; private incident details stay in their source tool.",
    {
      ...marketing,
      gate: "admin",
      date: id === "access-reviews" ? 'r."completedAt"' : 'r."dateOn"',
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
export const DEFINITIONS: readonly Definition[] = defs;
export function allowedDefinitions(access: Access) {
  return DEFINITIONS.filter((d) => !d.gate || access[d.gate]);
}
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
