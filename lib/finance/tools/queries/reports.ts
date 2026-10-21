import "server-only";
import { budgetReportActuals } from "@/lib/finance/reportMetrics";
import { monthlyCashFlow } from "@/lib/finance/recurring/cash-flow";
import { prisma } from "@/lib/db";
import { dateOnly } from "@/lib/finance/dates";
import { type FinanceActor } from "@/lib/finance/tools/access";
import { reportEntries } from "./report-entries";
import { groupMoney } from "./money-groups";
import type { FinanceQuery } from "./period";

export async function financeReports(actor: FinanceActor, query: FinanceQuery) {
  const { entries, period } = await reportEntries(actor, query);
  const budgets = await prisma.budget.findMany({
    where: {
      workspaceId: actor.workspace.id,
      currency: period.currency,
      periodStart: { lte: dateOnly(period.to) },
      periodEnd: { gte: dateOnly(period.from) },
      ...(query.centre ? { costCentreId: query.centre } : {}),
    },
    orderBy: { name: "asc" },
  });
  const actuals = await budgetReportActuals(actor.workspace.id, budgets.map(b => b.id));
  const budgetRows = budgets.map(b => ({ ...b, actualMinor: actuals.get(b.id) ?? 0 }));
  return {
    period,
    entries,
    incomeBySource: groupMoney(
      entries.filter((e) => e.kind === "INCOME"),
      (e) => e.incomeSource,
    ),
    incomeByFunder: groupMoney(
      entries.filter((e) => e.kind === "INCOME"),
      (e) => e.counterparty ?? "Not recorded",
    ),
    spendingByCategory: groupMoney(
      entries.filter((e) => e.kind === "EXPENSE"),
      (e) => e.category?.name ?? "Uncategorised",
    ),
    spendingByVendor: groupMoney(
      entries.filter((e) => e.kind === "EXPENSE"),
      (e) => e.counterparty ?? "Not recorded",
    ),
    centres: groupMoney(entries, (e) => e.costCentre?.name ?? "No cost centre"),
    monthly: await monthlyCashFlow(actor.workspace.id,period,query.centre),
    budgets: budgetRows,
    disbursementPurposes: groupMoney(
      entries.filter((e) => e.sourceType === "finance_disbursement"),
      (e) => e.purpose ?? e.description,
    ),
    disbursementCentres: groupMoney(
      entries.filter((e) => e.sourceType === "finance_disbursement"),
      (e) => e.costCentre?.name ?? "No cost centre",
    ),
  };
}
