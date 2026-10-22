import "server-only";
import type { DefinitionRegistry } from "./registry";
import { ledger } from "./sources";

export function registerLedger({ defs, add }: DefinitionRegistry) {
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
}
