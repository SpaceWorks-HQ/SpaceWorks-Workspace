import "server-only";
import { minorToDecimalString } from "@/lib/finance/money";
import { financeAccess, type FinanceActor } from "./access";
import { toolPeriod, type FinanceQuery } from "./queries";
import type { ExportKind } from "./export/context";
import { payrollCsv } from "./export/payroll";
import { billsCsv } from "./export/bills";
import { fundsCsv } from "./export/funds";
import { budgetsCsv } from "./export/budgets";
import { disbursementsCsv } from "./export/disbursements";
import { reportsCsv } from "./export/reports";

export { EXPORT_KINDS, type ExportKind } from "./export/context";

export async function financeCsv(
  actor: FinanceActor,
  kind: ExportKind,
  query: FinanceQuery,
) {
  const payroll = kind === "payroll" || kind === "statutory";
  await financeAccess(actor, payroll ? "PAY_VIEW" : "VIEW");
  const p = toolPeriod(actor, query),
    workspaceId = actor.workspace.id,
    c = p.currency,
    m = (v: number) => minorToDecimalString(v, c);
  const context = { actor, query, p, workspaceId, c, m };
  if (payroll) return payrollCsv(context, kind);
  if (kind === "bills") return billsCsv(context);
  if (kind === "funds") return fundsCsv(context);
  if (kind === "budgets") return budgetsCsv(context);
  if (kind.startsWith("disbursement")) return disbursementsCsv(context, kind);
  return reportsCsv(context, kind);
}
