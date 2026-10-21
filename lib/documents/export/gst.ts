import "server-only";

import { prisma } from "@/lib/db";
import { DocumentsError, type DocumentsActor } from "../access";
import { GST_TYPES } from "../rules";
import { type DocumentSnapshot } from "../service";
import type { ExportRows } from "./types";

export async function gstExport(actor: DocumentsActor, rows: ExportRows, start: string, end: string) {
  const data: unknown[][] = [];
  const header = [
    "Working table",
    "Supplier GSTIN",
    "Recipient GSTIN",
    "Number",
    "Date",
    "Status",
    "Type",
    "Place of supply",
    "Supply category",
    "HSN/SAC",
    "UQC",
    "Quantity",
    "Rate percent",
    "Taxable minor",
    "CGST minor",
    "SGST minor",
    "IGST minor",
    "Cess minor",
    "IRN",
    "Original ID",
  ];
  for (const r of rows) {
    const s = r.snapshot as unknown as DocumentSnapshot | null;
    if (
      !s ||
      (["CREDIT_NOTE", "DEBIT_NOTE"].includes(r.type) &&
        !s.input.gstAdjustment) ||
      !GST_TYPES.includes(r.type) ||
      !["ISSUED", "CANCELLED"].includes(r.status)
    )
      continue;
    for (const l of s.calculation.rows) {
      const table =
        r.type === "RECEIPT_VOUCHER"
          ? "AT"
          : r.type === "REFUND_VOUCHER"
            ? "ATADJ"
            : r.type.endsWith("NOTE")
              ? "CDNR"
              : s.input.supplyCategory.startsWith("EXPORT")
                ? "EXP"
                : s.input.partyTaxId
                  ? "B2B"
                  : "B2CS";
      data.push([
        table,
        s.registration.identifier,
        s.input.partyTaxId,
        r.number,
        s.input.issuedOn,
        r.status,
        r.type,
        s.input.placeOfSupply,
        s.input.supplyCategory,
        l.hsn,
        l.unit,
        l.quantity,
        l.rateBps / 100,
        l.taxableMinor,
        l.cgstMinor,
        l.sgstMinor,
        l.igstMinor,
        l.cessMinor,
        s.evidence?.irn,
        Array.isArray(s.source.noteAllocations)
          ? (
              s.source.noteAllocations as Array<{
                number: string;
                date: string;
              }>
            )
              .map((a) => `${a.number} (${a.date})`)
              .join("; ")
          : r.parentId,
      ]);
    }
  }
  // An advance is adjusted only when actually allocated, including advances
  // issued in an earlier period. Cumulative rounding conserves each component.
  const advances = await prisma.businessDocument.findMany({
    where: {
      workspaceId: actor.workspace.id,
      type: "RECEIPT_VOUCHER",
      status: "ISSUED",
      payments: {
        some: {
          createdAt: {
            gte: new Date(start),
            lt: new Date(new Date(end).getTime() + 86400000),
          },
        },
      },
    },
    include: {
      payments: {
        include: { invoice: { select: { number: true, status: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    take: 10001,
  });
  if (
    advances.length > 10000 ||
    advances.reduce((sum, r) => sum + r.payments.length, 0) > 10000
  )
    throw new DocumentsError(
      "Shorten the export to at most 10,000 advance allocations.",
    );
  for (const advance of advances) {
    const snapshot = advance.snapshot as unknown as DocumentSnapshot;
    const total = snapshot.calculation.totalMinor;
    if (total <= 0) continue;
    let used = 0;
    const part = (component: number, amount: number) =>
      Number(
        (BigInt(component) * BigInt(amount) * BigInt(2) + BigInt(total)) /
          (BigInt(total) * BigInt(2)),
      );
    for (const allocation of advance.payments) {
      const previous = used;
      used += allocation.cashMinor + allocation.tdsMinor;
      const day = allocation.createdAt.toISOString().slice(0, 10);
      if (day < start || day > end || allocation.invoice.status !== "ISSUED")
        continue;
      for (const line of snapshot.calculation.rows)
        data.push([
          "ATADJ",
          snapshot.registration.identifier,
          snapshot.input.partyTaxId,
          advance.number,
          day,
          advance.status,
          "ADVANCE_ALLOCATION",
          snapshot.input.placeOfSupply,
          snapshot.input.supplyCategory,
          line.hsn,
          line.unit,
          "",
          line.rateBps / 100,
          ...[
            line.taxableMinor,
            line.cgstMinor,
            line.sgstMinor,
            line.igstMinor,
            line.cessMinor,
          ].map(
            (component) => part(component, used) - part(component, previous),
          ),
          snapshot.evidence?.irn,
          allocation.invoice.number,
        ]);
    }
  }
  return { header, data };
}
