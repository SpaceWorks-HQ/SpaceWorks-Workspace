import "server-only";

import { prisma } from "@/lib/db";
import { type DocumentsActor } from "../access";
import { refundState } from "../refunds";
import { type DraftInput } from "../rules";
import { type DocumentSnapshot } from "../service";
import type { ExportRows } from "./types";

export async function registerExport(actor: DocumentsActor, rows: ExportRows) {
  const header = [
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
  const data = rows.map((r) => {
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
  return { header, data };
}

export async function seriesExport(actor: DocumentsActor, rows: ExportRows) {
  const header = [
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
  const data = series.map((s) => {
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
  return { header, data };
}
