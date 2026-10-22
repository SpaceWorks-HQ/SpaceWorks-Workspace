import "server-only";
import type { DefinitionRegistry } from "./registry";
import { ledger } from "./sources";

export function registerCommitments({ add }: DefinitionRegistry) {
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
}
