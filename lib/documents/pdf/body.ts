import "server-only";
import { formatMoney } from "@/lib/format/money";
import {
  donationForm,
  financialYear,
  inrWords,
  LETTERS,
} from "../rules";
import type { DocumentSnapshot } from "../service";

import type { DocumentLayout } from "./layout";

export function drawDocumentBody(s: DocumentSnapshot, layout: DocumentLayout) {
  const { paragraph, section, ensure, money, line } = layout;
  const v = s.input,
    c = s.calculation;
  paragraph(String(s.identity.name), true, 15);
  paragraph(String(s.identity.address || ""));
  paragraph(
    [
      s.identity.registration && `Registration: ${s.identity.registration}`,
      s.identity.pan && `PAN: ${s.identity.pan}`,
      s.identity.tan && `TAN: ${s.identity.tan}`,
      s.profile.cin && `CIN: ${s.profile.cin}`,
      s.profile.contact,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  if (s.registration.identifier)
    paragraph(
      `${s.registration.kind}: ${s.registration.identifier} | ${s.registration.address || ""}`,
    );
  section("Recipient");
  paragraph(v.partyName, true, 12);
  paragraph(v.partyAddress);
  if (v.partyTaxId) paragraph(`Recipient tax ID: ${v.partyTaxId}`);
  if (v.deliveryAddress) paragraph(`Delivery: ${v.deliveryAddress}`);
  if (v.dueOn) paragraph(`Due: ${v.dueOn}`);
  if (v.supplyOn) paragraph(`Supply / tax point: ${v.supplyOn}`);
  if (v.placeOfSupply)
    paragraph(
      `Place of supply: ${v.placeOfSupply} | Rule: ${v.placeRule} | ${v.supplyCategory}`,
    );
  if (v.componentOverride)
    paragraph(
      `Reviewed tax override: ${v.componentOverride} | ${v.overrideReason}`,
    );
  if (Array.isArray(s.source.noteAllocations))
    for (const original of s.source.noteAllocations as Array<{
      number: string;
      date: string;
      amountMinor: number;
    }>)
      paragraph(
        `Original: ${original.number} | ${original.date} | Adjustment: ${money(original.amountMinor)}`,
      );
  if (v.parentId)
    paragraph(
      `Original document: ${String(s.source.originalNumber || v.parentId)}`,
    );
  if (LETTERS.includes(v.type)) {
    section(v.title);
    paragraph(s.letter, false, 12);
  } else if (v.type === "US_ACKNOWLEDGEMENT" && v.paymentMode === "IN_KIND") {
    section("Contributed property");
    for (const row of c.rows) paragraph(row.description);
    paragraph("No deductible value is assigned to contributed property.");
  } else if (c.rows.length) {
    section("Items and tax");
    for (const [index, r] of c.rows.entries()) {
      ensure(95);
      layout.page.drawLine({
        start: { x: 40, y: layout.y + 5 },
        end: { x: 551, y: layout.y + 5 },
        color: line,
        thickness: 0.5,
      });
      paragraph(`${index + 1}. ${r.description}`, true);
      paragraph(
        `${r.quantity} ${r.unit} × ${money(r.unitMinor)} | HSN/SAC ${r.hsn || "—"} | Discount ${money(r.discountMinor)}`,
      );
      paragraph(
        `Taxable ${money(r.taxableMinor)} | Rate ${r.rateBps / 100}% | CGST ${money(r.cgstMinor)} | SGST/UTGST ${money(r.sgstMinor)}`,
      );
      paragraph(
        `IGST ${money(r.igstMinor)} | VAT ${money(r.vatMinor)} | Cess ${money(r.cessMinor)}${r.exempt ? ` | Exemption: ${r.exemption}` : ""}`,
      );
    }
    section("Totals");
    paragraph(
      `Taxable: ${money(c.taxableMinor)} | CGST: ${money(c.cgstMinor)} | SGST/UTGST: ${money(c.sgstMinor)}`,
    );
    paragraph(
      `IGST: ${money(c.igstMinor)} | VAT: ${money(c.vatMinor)} | Cess: ${money(c.cessMinor)} | Round-off: ${money(c.roundOffMinor)}`,
    );
    paragraph(`Total: ${money(c.totalMinor)}`, true, 15);
    if (v.currency === "INR") paragraph(inrWords(c.totalMinor));
    if (v.reverseCharge)
      paragraph(
        "Reverse charge: Yes. Tax is payable by the recipient; it is excluded from the collectible total.",
      );
    if (v.type === "BILL_OF_SUPPLY")
      paragraph(
        s.profile.gstScheme === "COMPOSITION"
          ? "Composition taxable person, not eligible to collect tax on supplies."
          : "Exempt supply. No GST charged.",
      );
    if (v.supplyCategory !== "DOMESTIC")
      paragraph(
        v.supplyCategory.endsWith("WITHOUT_TAX")
          ? "Supply meant for export / SEZ under bond or letter of undertaking without payment of integrated tax."
          : "Supply meant for export / SEZ on payment of integrated tax.",
      );
  }
  if (v.paymentOn) {
    section("Payment record");
    paragraph(
      `Payment date: ${v.paymentOn} | Mode: ${v.paymentMode} | Reference: ${v.paymentReference}`,
    );
    if (s.source.originalPayment) {
      const original = s.source.originalPayment as {
        amountMinor: number;
        currency: string;
      };
      paragraph(
        `Original payment: ${formatMoney(original.amountMinor, original.currency)} | INR reporting basis: ${s.source.exchangeBasis}`,
      );
    }
    paragraph(
      `${["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type) ? "Cash returned" : "Actual cash"}: ${money(v.cashMinor)} | Withholding: ${money(v.tdsMinor)} | Section: ${v.tdsSection || "Not applicable"}`,
    );
  }
  if (Array.isArray(s.source.refundAllocations))
    for (const allocation of s.source.refundAllocations as Array<{
      number: string;
      cashMinor: number;
    }>)
      paragraph(
        `Cash allocation reversed: ${allocation.number} | ${money(allocation.cashMinor)}`,
      );
  if (v.type.startsWith("DONATION") || v.type === "FCRA_RECEIPT") {
    section(
      v.type === "DONATION_CERTIFICATE"
        ? `Certificate details — Form ${donationForm(v.paymentOn).certificate}`
        : "Donation acknowledgement",
    );
    paragraph(
      `Category: ${v.donationCategory} | Purpose: ${v.programme || v.title}`,
    );
    if (v.type === "DONATION_CERTIFICATE") {
      const a = s.registration.approval as Record<string, unknown>;
      paragraph(
        `Approval / URN: ${a.identifier} | Order: ${a.orderDate} | Validity: ${a.validFrom} to ${a.validTo}`,
      );
      paragraph(
        `Donor ID (${v.donorIdType}): ${v.donorId} | Section: ${v.deductionSection} | Imported portal acknowledgement / Pre-ARN: ${v.portalReference}`,
      );
      paragraph(
        `Donation year: ${financialYear(v.paymentOn)} | Filing reference: ${v.filingReference || "Awaiting filing"}`,
      );
      paragraph(
        "Deduction remains subject to applicable law and the donor's eligibility. Retain the official portal certificate with this record.",
      );
    } else
      paragraph(
        "Ordinary acknowledgement of funds received. This is not a statutory donation-deduction certificate.",
      );
    if (v.type === "FCRA_RECEIPT")
      paragraph(
        `FCRA designated account confirmed | Donor country: ${v.donorCountry} | Foreign source basis: ${v.foreignSourceBasis} | Conversion: ${v.exchangeBasis} | INR amount (minor units): ${v.inrMinor}`,
      );
  }
  if (v.type === "US_ACKNOWLEDGEMENT")
    paragraph(
      `Goods or services in return: ${v.benefits} | Good-faith benefit value: ${money(v.benefitValueMinor)}. Non-cash property is described without a deductible valuation.`,
    );
  if (v.type === "VAT_INVOICE" && s.profile.country === "GB")
    paragraph(
      `VAT payable in sterling: ${formatMoney(v.vatSterlingMinor, "GBP")}`,
    );
  if (v.type === "CSR_UC" || v.type === "GOVERNMENT_UC") {
    section(
      v.type === "GOVERNMENT_UC"
        ? "GFR 12-A working certificate — authority format review required"
        : "CSR agreement utilisation certificate",
    );
    paragraph(`Period: ${v.periodStart} to ${v.periodEnd}`);
    paragraph(v.sanction);
    paragraph(
      `Opening: ${money(v.openingMinor)} | Receipts: ${money(v.receiptsMinor)} | Interest: ${money(v.interestMinor)}`,
    );
    paragraph(
      `Expenditure: ${money(v.expenditureMinor)} | Refunds / interest returned: ${money(v.refundsMinor)} | Unadjusted advances: ${money(v.advancesMinor)}`,
    );
    paragraph(
      `Closing balance: ${money(v.openingMinor + v.receiptsMinor + v.interestMinor - v.expenditureMinor - v.refundsMinor)}`,
    );
    paragraph(v.schedules);
    paragraph(v.outcomes);
    section("Fund ledger schedule");
    for (const row of (s.source.schedule ?? []) as Array<{
      id: string;
      date: string;
      kind: string;
      amountMinor: number;
    }>)
      paragraph(
        `${row.date} | ${row.kind} | ${money(row.amountMinor)} | ${row.id}`,
      );
  }
}
