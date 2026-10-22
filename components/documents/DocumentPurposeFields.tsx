"use client";

import type { DocumentDraft } from "./useDocumentDraft";
import { label, type DraftInput } from "@/lib/documents/rules";
import { currencyMinorDigits } from "@/lib/format/money";

export function DocumentPurposeFields({ draft }: { draft: DocumentDraft }) {
  const {
    initial,
    options,
    type,
    currency,
    gst,
    donation,
    uc,
    receipt,
    isLetter,
    f,
    section,
    refs,
  } = draft;
  return (
    <>
      {receipt
        ? section("Payment and withholding", [
            f("paymentOn", "Payment date", "date"),
            {
              ...f("paymentMode", "Payment mode", "select"),
              options: [
                "CASH",
                "BANK",
                "UPI",
                "CHEQUE",
                "CARD",
                "OTHER",
                "IN_KIND",
              ].map((id) => ({ id, name: label(id) })),
            },
            f("paymentReference", "Bank / UPI / cheque reference"),
            {
              ...f(
                "cashMinor",
                ["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(type)
                  ? "Actual cash returned"
                  : type === "PAYMENT_VOUCHER"
                    ? "Actual cash paid"
                    : "Actual cash received",
              ),
              value: (
                initial.cashMinor /
                10 ** currencyMinorDigits(currency)
              ).toFixed(currencyMinorDigits(currency)),
            },
            {
              ...f("tdsMinor", "TDS withheld by customer"),
              value: (
                initial.tdsMinor /
                10 ** currencyMinorDigits(currency)
              ).toFixed(currencyMinorDigits(currency)),
            },
            f("tdsSection", "Withholding section"),
          ])
        : null}
      {donation
        ? section("Donation certificate details", [
            {
              ...f("donorIdType", "Donor identification type", "select"),
              options: [
                "PAN",
                "PASSPORT",
                "VOTER_ID",
                "FOREIGN_TIN",
                "AADHAAR",
                "DRIVING_LICENCE",
                "RATION_CARD",
              ].map((id) => ({ id, name: label(id) })),
            },
            f("donorId", "Donor identification"),
            {
              ...f("donationCategory", "Donation category", "select"),
              options: [
                "CORPUS",
                "VOLUNTARY",
                "SPECIFIC_GRANT",
                "CSR",
                "OTHER",
              ].map((id) => ({ id, name: label(id) })),
            },
            {
              ...f("approvalId", "Donation approval", "select"),
              options: refs("REGISTRATION"),
            },
            f("deductionSection", "Deduction section (80G / 354)"),
            {
              ...f("portalReferenceType", "Imported reference type", "select"),
              options: [
                { id: "PRE_ARN", name: "Portal-generated Pre-ARN" },
                {
                  id: "CERTIFICATE_ACK",
                  name: "Official certificate acknowledgement",
                },
              ],
            },
            f("portalReference", "Imported portal acknowledgement / Pre-ARN"),
            f("portalDate", "Portal certificate date", "date"),
            f("filingReference", "Accepted filing reference"),
            f("programme", "Purpose / campaign"),
            f(
              "exchangeBasis",
              "Foreign donation conversion rate, source and date",
            ),
            {
              ...f("inrMinor", "INR reporting amount"),
              value: (initial.inrMinor / 100).toFixed(2),
            },
          ])
        : null}
      {type === "FCRA_RECEIPT"
        ? section("Foreign contribution", [
            f(
              "fcraAccount",
              "Received in the designated FCRA account",
              "checkbox",
            ),
            f("donorCountry", "Donor country"),
            f("foreignSourceBasis", "Foreign-source classification evidence"),
            f("exchangeBasis", "Conversion rate, source and date"),
            {
              ...f("inrMinor", "INR reporting amount"),
              value: (initial.inrMinor / 100).toFixed(2),
            },
          ])
        : null}
      {isLetter
        ? section("Letter and merge fields", [
            {
              ...f("personId", "Person record", "select"),
              options: options.people,
            },
            {
              ...f("templateId", "Approved template", "select"),
              options: refs("TEMPLATE"),
            },
            f("role", "Role"),
            f("programme", "Programme"),
            f("startsOn", "Engagement start", "date"),
            f("endsOn", "Engagement end", "date"),
            f("hours", "Verified hours"),
            f(
              "letterBody",
              "Letter wording",
              "textarea",
              "Merge fields: {{person}}, {{start}}, {{end}}, {{role}}, {{programme}}, {{hours}}, {{signatory}}, {{date}}. Leave blank to use the selected template.",
            ),
          ])
        : null}
      {uc
        ? section("Utilisation and schedules", [
            f("periodStart", "Period start", "date"),
            f("periodEnd", "Period end", "date"),
            f("sanction", "Sanction numbers, dates and agreement", "textarea"),
            ...[
              "openingMinor",
              "receiptsMinor",
              "interestMinor",
              "expenditureMinor",
              "refundsMinor",
              "advancesMinor",
            ].map((n) => ({
              ...f(n as keyof DraftInput, label(n.replace("Minor", ""))),
              value: (
                Number(initial[n as keyof DraftInput]) /
                10 ** currencyMinorDigits(currency)
              ).toFixed(currencyMinorDigits(currency)),
            })),
            f(
              "schedules",
              "Component-wise schedules and certifications",
              "textarea",
            ),
            f("outcomes", "Outcomes, checks and sign-off wording", "textarea"),
          ])
        : null}
      {type === "US_ACKNOWLEDGEMENT"
        ? section("US acknowledgement", [
            f(
              "benefits",
              "Goods or services supplied in return (state none if none)",
              "textarea",
            ),
            {
              ...f("benefitValueMinor", "Good-faith benefit value"),
              value: (initial.benefitValueMinor / 100).toFixed(2),
            },
          ])
        : null}
      {gst
        ? section("Manual portal evidence", [
            f(
              "irnRequired",
              "IRP evidence required before final issue",
              "checkbox",
            ),
            f("ewayReference", "E-way-bill reference"),
          ])
        : null}
    </>
  );
}
