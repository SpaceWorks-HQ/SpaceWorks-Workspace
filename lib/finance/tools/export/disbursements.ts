import "server-only";
import { toCsv } from "@/lib/finance/csv";
import { isoDay, dateOnly } from "@/lib/finance/dates";
import { prisma } from "@/lib/db";
import { capped, type ExportContext, type ExportKind } from "./context";

export async function disbursementsCsv(context: ExportContext, kind: ExportKind) {
  const { p, workspaceId, c, m, query } = context;
  const rows = capped(
    await prisma.financeDisbursement.findMany({
      where: {
        workspaceId,
        currency: c,
        ...(kind === "disbursements"
          ? {
              OR: [
                {
                  status: "PAID",
                  paidOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
                },
                {
                  status: { not: "PAID" },
                  createdAt: {
                    gte: dateOnly(p.from),
                    lt: new Date(+dateOnly(p.to) + 86400000),
                  },
                },
              ],
            }
          : {
              status: "PAID",
              paidOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
            }),
        ...(query.centre ? { costCentreId: query.centre } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 20001,
    }),
  );
  if (kind === "disbursements")
    return toCsv([
      [
        "Payee",
        "Purpose",
        "Type",
        "Currency",
        "Total payout",
        "TDS",
        "Status",
        "Cost centre ID",
        "Paid date",
        "Reference",
        "Settled",
        "Unsettled",
      ],
      ...rows.map((r) => [
        r.payee,
        r.purpose,
        r.kind,
        c,
        m(r.amountMinor),
        m(r.tdsMinor),
        r.status,
        r.costCentreId,
        r.paidOn ? isoDay(r.paidOn) : "",
        r.reference,
        m(r.settledMinor),
        r.kind === "ADVANCE" ? m(r.amountMinor - r.settledMinor) : "",
      ]),
    ]);
  const centres = await prisma.financeCostCentre.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    }),
    groups = new Map<string, number>();
  for (const r of rows) {
    const key =
      kind === "disbursement-purposes"
        ? r.purpose
        : (centres.find((a) => a.id === r.costCentreId)?.name ??
          "No cost centre");
    groups.set(key, (groups.get(key) ?? 0) + r.amountMinor);
  }
  return toCsv([
    [
      kind === "disbursement-purposes" ? "Purpose" : "Programme",
      "Currency",
      "Total",
    ],
    ...[...groups].map(([name, value]) => [name, c, m(value)]),
  ]);
}
