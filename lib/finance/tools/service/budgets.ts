import "server-only";
import {
  prisma,
  type DbClient,
} from "@/lib/db";
import { toolSchemas } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  financeAccess,
  lockFinance,
  unavailable,
  validateTags,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { financeNote } from "./notes";

export async function saveBudget(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.budget.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await validateTags(tx, actor.workspace.id, v, v.currency, "EXPENSE");
    const { id, categoryId, periodStart, periodEnd, ...rest } = v;
    if (
      (categoryId || v.costCentreId) &&
      (await tx.budget.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: id ? { not: id } : undefined,
          currency: v.currency,
          costCentreId: v.costCentreId,
          categories: { equals: categoryId ? [categoryId] : [] },
          periodStart: dateOnly(periodStart),
          periodEnd: dateOnly(periodEnd),
        },
      }))
    )
      throw new FinanceError(
        "A budget line already covers this category, cost centre and period. Edit that line.",
      );
    const data = {
      ...rest,
      periodStart: dateOnly(periodStart),
      periodEnd: dateOnly(periodEnd),
      categories: categoryId ? [categoryId] : [],
      thresholdsPct: [80, 100],
    };
    if (
      id &&
      !(
        await tx.budget.updateMany({
          where: { id, workspaceId: actor.workspace.id },
          data,
        })
      ).count
    )
      throw new FinanceError(unavailable);
    const rowId =
      id ??
      (
        await tx.budget.create({
          data: {
            ...data,
            workspaceId: actor.workspace.id,
            createdById: actor.user.id,
          },
        })
      ).id;
    await financeNote(tx, actor, "budget", rowId, "saved", v.name, "budgets");
    return rowId;
  });
}

/** Category lines count ledger actuals automatically; legacy budgets retain explicit entry links. */
export function budgetActualWhere(budget: {
  id: string;
  workspaceId: string;
  currency: string;
  categories: string[];
  costCentreId: string | null;
  periodStart: Date;
  periodEnd: Date;
}) {
  return {
    workspaceId: budget.workspaceId,
    currency: budget.currency,
    kind: "EXPENSE" as const,
    voidedAt: null,
    occurredOn: { gte: budget.periodStart, lte: budget.periodEnd },
    ...(budget.categories.length || budget.costCentreId
      ? {
          ...(budget.categories.length
            ? { categoryId: { in: budget.categories } }
            : {}),
          ...(budget.costCentreId ? { costCentreId: budget.costCentreId } : {}),
        }
      : { budgetId: budget.id }),
  };
}
export async function budgetActual(
  tx: DbClient,
  budget: Parameters<typeof budgetActualWhere>[0],
) {
  return (
    (
      await tx.ledgerEntry.aggregate({
        where: budgetActualWhere(budget),
        _sum: { amountMinor: true },
      })
    )._sum.amountMinor ?? 0
  );
}
