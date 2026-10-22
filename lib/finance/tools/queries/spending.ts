import "server-only";
import { prisma } from "@/lib/db";
import {
  dateOnly,
  monthKeys,
} from "@/lib/finance/dates";
import {
  possibleDuplicates,
  monthPeriod,
} from "@/lib/finance/tools-rules";
import { type FinanceActor } from "@/lib/finance/tools/access";
import {
  toolPeriod,
  type FinanceQuery,
} from "./period";
import { reportEntries } from "./report-entries";
import { financeReports } from "./reports";
import { groupMoney } from "./money-groups";

export async function spendingReview(actor: FinanceActor, query: FinanceQuery) {
  const selected = toolPeriod(actor, query);
  const period = monthPeriod(selected.month);
  const current = await financeReports(actor, {
    ...query,
    from: period.start,
    to: period.end,
  });
  const previousMonth = monthKeys(`${current.period.month}-01`, 2)[0]!;
  const previous = await reportEntries(actor, {
    month: previousMonth,
    currency: current.period.currency,
    centre: query.centre,
    q: query.q,
  });
  const expenses = current.entries.filter((e) => e.kind === "EXPENSE");
  const rules = await prisma.financeReviewRule.findMany({
    where: {
      workspaceId: actor.workspace.id,
      currency: current.period.currency,
    },
  });
  const review = await prisma.financeMonth.findUnique({
    where: {
      workspaceId_month: {
        workspaceId: actor.workspace.id,
        month: current.period.month,
      },
    },
  });
  // Include seven days before the period for duplicate pairs crossing a month boundary.
  const lookback = new Date(+dateOnly(current.period.from) - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const duplicateEntries = await reportEntries(actor, {
    ...query,
    from: lookback,
    to: current.period.to,
    currency: current.period.currency,
  });
  const duplicates = possibleDuplicates(
    duplicateEntries.entries.filter((e) => e.kind === "EXPENSE"),
  ).filter((pair) => pair.some((id) => expenses.some((e) => e.id === id)));
  return {
    ...current,
    previous: previous.entries.filter((e) => e.kind === "EXPENSE"),
    byPerson: groupMoney(expenses, (e) => e.createdBy?.name ?? "Former member"),
    missingReceipts: expenses.filter((e) => !e.receipts.length && !e.hasControlProof),
    biggest: [...expenses]
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, 10),
    duplicates,
    duplicateEntries: duplicateEntries.entries,
    overThreshold: expenses.filter((e) =>
      rules.some(
        (r) =>
          r.categoryId === e.categoryId && e.amountMinor > r.thresholdMinor,
      ),
    ),
    rules,
    review,
  };
}
