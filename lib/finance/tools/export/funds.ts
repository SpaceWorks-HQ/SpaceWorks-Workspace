import "server-only";
import { toCsv } from "@/lib/finance/csv";
import { dateOnly } from "@/lib/finance/dates";
import { prisma } from "@/lib/db";
import { capped, type ExportContext } from "./context";

export async function fundsCsv(context: ExportContext) {
  const { p, workspaceId, c, m } = context;
  const funds = capped(
    await prisma.financeFund.findMany({
      where: { workspaceId, currency: c },
      orderBy: { name: "asc" },
      take: 20001,
    }),
  );
  const rows = await Promise.all(
    funds.map(async (f) => {
      const sum = await prisma.ledgerEntry.groupBy({
        by: ["kind"],
        where: {
          workspaceId,
          fundId: f.id,
          currency: c,
          voidedAt: null,
          occurredOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
        },
        _sum: { amountMinor: true },
      });
      const opening = await prisma.ledgerEntry.groupBy({
        by: ["kind"],
        where: {
          workspaceId,
          fundId: f.id,
          currency: c,
          voidedAt: null,
          occurredOn: { lt: dateOnly(p.from) },
        },
        _sum: { amountMinor: true },
      });
      const net = opening.reduce(
          (n, r) =>
            n + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amountMinor ?? 0),
          0,
        ),
        income = sum.find((r) => r.kind === "INCOME")?._sum.amountMinor ?? 0,
        expense =
          sum.find((r) => r.kind === "EXPENSE")?._sum.amountMinor ?? 0;
      return [
        f.name,
        f.restricted ? "Restricted" : "Unrestricted",
        f.funder,
        c,
        p.from,
        p.to,
        m(net),
        m(income),
        m(expense),
        m(net + income - expense),
      ];
    }),
  );
  return toCsv([
    [
      "Fund",
      "Restriction",
      "Funder",
      "Currency",
      "From",
      "To",
      "Opening",
      "Money in",
      "Money spent",
      "Closing",
    ],
    ...rows,
  ]);
}
