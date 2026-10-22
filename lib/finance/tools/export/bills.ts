import "server-only";
import { toCsv } from "@/lib/finance/csv";
import { isoDay, dateOnly } from "@/lib/finance/dates";
import { prisma } from "@/lib/db";
import { capped, type ExportContext } from "./context";
import { billStatus } from "@/lib/finance/tools-rules";

export async function billsCsv(context: ExportContext) {
  const { p, workspaceId, c, m, query } = context;
  const bills = capped(
    await prisma.financeBill.findMany({
      where: {
        workspaceId,
        privatePayroll: false,
        currency: c,
        issuedOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
        ...(query.centre ? { costCentreId: query.centre } : {}),
      },
      orderBy: { issuedOn: "asc" },
      take: 20001,
      include: { payments: { orderBy: { paidOn: "asc" } } },
    }),
  );
  return toCsv([
    [
      "Vendor",
      "Bill number",
      "Bill date",
      "Due date",
      "Currency",
      "Amount",
      "Paid",
      "Unpaid",
      "Status",
      "GSTIN or tax ID",
      "Taxable value",
      "CGST",
      "SGST",
      "IGST",
      "TDS",
      "Purpose",
      "Cost centre ID",
      "Fund ID",
      "Payment dates",
      "Payment references",
    ],
    ...bills.map((b) => [
      b.vendor,
      b.number,
      isoDay(b.issuedOn),
      isoDay(b.dueOn),
      c,
      m(b.amountMinor),
      m(b.paidMinor),
      m(b.amountMinor - b.paidMinor),
      billStatus(b.amountMinor, b.paidMinor),
      b.gstin,
      m(b.taxableMinor),
      m(b.cgstMinor),
      m(b.sgstMinor),
      m(b.igstMinor),
      m(b.tdsMinor),
      b.purpose,
      b.costCentreId,
      b.fundId,
      b.payments.map((a) => isoDay(a.paidOn)).join("; "),
      b.payments.map((a) => a.reference).join("; "),
    ]),
  ]);
}
