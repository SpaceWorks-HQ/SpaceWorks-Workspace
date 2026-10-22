import "server-only";
import { toCsv } from "@/lib/finance/csv";
import { isoDay, dateOnly } from "@/lib/finance/dates";
import { prisma } from "@/lib/db";
import { capped, type ExportContext } from "./context";
import { budgetActual } from "../service";

export async function budgetsCsv(context: ExportContext) {
  const { p, workspaceId, c, m, query } = context;
  const budgets = capped(
    await prisma.budget.findMany({
      where: {
        workspaceId,
        currency: c,
        periodStart: { lte: dateOnly(p.to) },
        periodEnd: { gte: dateOnly(p.from) },
        ...(query.centre ? { costCentreId: query.centre } : {}),
      },
      take: 20001,
      orderBy: { periodStart: "asc" },
    }),
  );
  const rows = await Promise.all(
    budgets.map(async (b) => {
      const actual = await budgetActual(prisma, b);
      return [
        b.name,
        isoDay(b.periodStart),
        isoDay(b.periodEnd),
        c,
        m(b.amountMinor),
        m(actual),
        m(actual - b.amountMinor),
        b.varianceNote,
        b.costCentreId,
        b.categories.join("; "),
      ];
    }),
  );
  return toCsv([
    [
      "Budget line",
      "Period start",
      "Period end",
      "Currency",
      "Budget",
      "Actual",
      "Variance actual minus budget",
      "Note",
      "Cost centre ID",
      "Category IDs",
    ],
    ...rows,
  ]);
}
