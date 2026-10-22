import "server-only";

import { type DocumentSnapshot } from "../service";
import type { ExportRows } from "./types";

export function hsnExport(rows: ExportRows) {
  const header = [
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
  const data = [...groups.values()];
  return { header, data };
}
