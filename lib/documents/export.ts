import "server-only";
import { refundState } from "./refunds";
import { prisma } from "@/lib/db";
import {
  dateSchema,
  csvCell,
  donationForm,
  donationReportingCodes,
  GST_TYPES,
  type DraftInput,
} from "./rules";
import { documentsAccess, DocumentsError, type DocumentsActor } from "./access";
import { audit, type DocumentSnapshot } from "./service";
export async function documentExport(
  actor: DocumentsActor,
  kind: string,
  start: string,
  end: string,
) {
  await documentsAccess(actor);
  dateSchema.parse(start);
  dateSchema.parse(end);
  if (end < start) throw new DocumentsError("Check the export dates.");
  const rows = await prisma.businessDocument.findMany({
    where: {
      workspaceId: actor.workspace.id,
      issuedOn: { gte: new Date(start), lte: new Date(end) },
      OR: [{ sourceType: null }, { sourceType: { not: "PAY_RUN" } }],
    },
    include: {
      allocations: true,
      payments: true,
      files: {
        include: {
          file: { select: { checksum: true, filename: true, size: true } },
        },
      },
    },
    orderBy: [{ issuedOn: "asc" }, { number: "asc" }],
    take: 10001,
  });
  if (rows.length > 10000)
    throw new DocumentsError("Shorten the export to at most 10,000 documents.");
  await audit(actor, `export_${kind}`, "register");
  if (kind === "filings") {
    const batches = await prisma.documentReference.findMany({
      where: { workspaceId: actor.workspace.id, kind: "FILING_BATCH" },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    return {
      type: "application/json",
      name: "filing-batches.json",
      body: JSON.stringify({ version: 1, batches }, null, 2),
    };
  }
  if (kind === "json")
    return {
      type: "application/json",
      name: "documents.json",
      body: JSON.stringify(
        {
          version: 1,
          preparedAt: new Date().toISOString(),
          start,
          end,
          documents: rows,
        },
        null,
        2,
      ),
    };
  let header: string[],
    data: unknown[][] = [];
  if (kind === "register") {
    header = [
      "Type",
      "Number",
      "Date",
      "Due",
      "Status",
      "Party",
      "Currency",
      "Taxable minor",
      "CGST minor",
      "SGST minor",
      "IGST minor",
      "Cess minor",
      "Total minor",
      "Cash allocated minor",
      "TDS allocated minor",
      "Cash received or returned minor",
      "TDS recorded minor",
      "Refunded cash minor",
      "Source",
      "Source ID",
      "Cancellation reason",
    ];
    const refunds = await refundState(actor.workspace.id);
    data = rows.map((r) => {
      const s = r.snapshot as unknown as DocumentSnapshot | null,
        v = r.input as unknown as DraftInput,
        c = s?.calculation;
      return [
        r.type,
        r.number,
        r.issuedOn.toISOString().slice(0, 10),
        r.dueOn?.toISOString().slice(0, 10),
        r.status,
        v.partyName,
        r.currency,
        c?.taxableMinor,
        c?.cgstMinor,
        c?.sgstMinor,
        c?.igstMinor,
        c?.cessMinor,
        r.totalMinor,
        r.allocations.reduce((n, a) => n + a.cashMinor, 0) -
          (refunds.invoices.get(r.id) ?? 0),
        r.allocations.reduce((n, a) => n + a.tdsMinor, 0),
        v.cashMinor,
        v.tdsMinor,
        refunds.receipts.get(r.id)?.total ?? 0,
        r.sourceType,
        r.sourceId,
        r.cancelReason,
      ];
    });
  } else if (kind === "hsn") {
    header = [
      "Supplier GSTIN",
      "Recipient category",
      "HSN/SAC",
      "UQC",
      "Rate percent",
      "Currency",
      "Quantity (thousandths)",
      "Taxable minor",
      "CGST minor",
      "SGST minor",
      "IGST minor",
      "Cess minor",
    ];
    const groups = new Map<string, unknown[]>();
    for (const r of rows) {
      const snapshot = r.snapshot as unknown as DocumentSnapshot | null;
      if (
        !snapshot ||
        r.status !== "ISSUED" ||
        ![
          "TAX_INVOICE",
          "BILL_OF_SUPPLY",
          "CREDIT_NOTE",
          "DEBIT_NOTE",
        ].includes(r.type) ||
        (["CREDIT_NOTE", "DEBIT_NOTE"].includes(r.type) &&
          !snapshot.input.gstAdjustment)
      )
        continue;
      for (const line of snapshot.calculation.rows) {
        const category = snapshot.input.partyTaxId ? "B2B" : "B2C",
          key = JSON.stringify([
            snapshot.registration.identifier,
            category,
            line.hsn,
            line.unit,
            line.rateBps,
            r.currency,
          ]);
        const sign = r.type === "CREDIT_NOTE" ? -1 : 1;
        const quantity = Math.round(Number(line.quantity) * 1000) * sign;
        const existing = groups.get(key);
        if (existing) {
          existing[6] = Number(existing[6]) + quantity;
          for (const [offset, field] of [
            [7, "taxableMinor"],
            [8, "cgstMinor"],
            [9, "sgstMinor"],
            [10, "igstMinor"],
            [11, "cessMinor"],
          ] as const)
            existing[offset] = Number(existing[offset]) + line[field] * sign;
        } else
          groups.set(key, [
            snapshot.registration.identifier,
            category,
            line.hsn,
            line.unit,
            line.rateBps / 100,
            r.currency,
            quantity,
            line.taxableMinor * sign,
            line.cgstMinor * sign,
            line.sgstMinor * sign,
            line.igstMinor * sign,
            line.cessMinor * sign,
          ]);
      }
    }
    data = [...groups.values()];
  } else if (["gst", "tax"].includes(kind)) {
    header = [
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
  } else if (kind === "donations") {
    header = [
      "Form",
      "Adapter version",
      "Receipt",
      "Status",
      "Donation date",
      "Donor name",
      "Address",
      "ID type",
      "ID",
      "Category code",
      "Mode code",
      "Section",
      "Approval URN",
      "Portal acknowledgement or Pre-ARN",
      "Currency",
      "INR minor",
      "Filing reference",
    ];
    const seen = new Set<string>();
    for (const r of [...rows].sort(
      (a, b) =>
        Number(b.type === "DONATION_CERTIFICATE") -
        Number(a.type === "DONATION_CERTIFICATE"),
    )) {
      if (
        !["DONATION_RECEIPT", "DONATION_CERTIFICATE"].includes(r.type) ||
        r.status !== "ISSUED"
      )
        continue;
      const sourceKey =
        r.sourceType && r.sourceId ? `${r.sourceType}:${r.sourceId}` : r.id;
      if (seen.has(sourceKey)) continue;
      seen.add(sourceKey);
      const s = r.snapshot as unknown as DocumentSnapshot,
        v = s.input,
        f = donationForm(v.paymentOn),
        approval = s.registration.approval as
          Record<string, unknown> | undefined;
      const codes =
        v.donorIdType && v.donationCategory && v.paymentMode
          ? donationReportingCodes(
              v.paymentOn,
              v.donorIdType,
              v.donationCategory,
              v.paymentMode,
            )
          : {
              idCode: "REVIEW REQUIRED",
              category: "REVIEW REQUIRED",
              mode: "REVIEW REQUIRED",
            };
      data.push([
        f.statement,
        f.version,
        r.number,
        r.status,
        v.paymentOn,
        v.partyName,
        v.partyAddress,
        codes.idCode,
        v.donorId,
        codes.category,
        codes.mode,
        v.deductionSection,
        approval?.identifier,
        v.portalReference,
        v.currency,
        v.currency === "INR" ? v.cashMinor : v.inrMinor,
        v.filingReference,
      ]);
    }
  } else if (kind === "series") {
    header = [
      "Type",
      "Registration",
      "Financial year",
      "Prefix",
      "Next number",
      "Locked",
      "Issued",
      "Cancelled",
      "Reserved",
    ];
    const series = await prisma.documentSeries.findMany({
      where: { workspaceId: actor.workspace.id },
    });
    data = series.map((s) => {
      const rr = rows.filter(
        (r) =>
          r.financialYear === s.financialYear &&
          r.type === s.type &&
          r.registrationId === s.registrationId,
      );
      return [
        s.type,
        s.registrationId,
        s.financialYear,
        s.prefix,
        s.nextNumber,
        s.locked,
        rr.filter((r) => r.status === "ISSUED").length,
        rr.filter((r) => r.status === "CANCELLED").length,
        rr.filter((r) => r.status === "RESERVED").length,
      ];
    });
  } else throw new DocumentsError("Choose an available export.");
  return {
    type: "text/csv; charset=utf-8",
    name: `documents-${kind}.csv`,
    body: [header, ...data]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n"),
  };
}
