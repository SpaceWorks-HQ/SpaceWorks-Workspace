import "server-only";

import { donationForm, donationReportingCodes } from "../rules";
import { type DocumentSnapshot } from "../service";
import type { ExportRows } from "./types";

export function donationsExport(rows: ExportRows) {
  const data: unknown[][] = [];
  const header = [
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
  return { header, data };
}
