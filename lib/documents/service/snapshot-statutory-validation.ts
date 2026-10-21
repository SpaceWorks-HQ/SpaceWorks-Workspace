import "server-only";
import { DocumentsError } from "../access";
import {
  donationForm,
  donationReportingCodes,
  type DraftInput,
  type TaxProfile,
} from "../rules";

export function validateSnapshotStatutoryFacts(
  v: DraftInput,
  profile: TaxProfile,
  details: Record<string, unknown>,
  registration: Record<string, unknown>,
  reference: (id: string, kind: string) => Record<string, unknown>,
  fundId: string | null,
) {
  if (v.type === "DONATION_CERTIFICATE") {
    if (v.currency !== "INR" || !v.reviewed)
      throw new DocumentsError(
        "Review eligibility and prepare this donation certificate in INR.",
      );
    const approval = reference(v.approvalId, "REGISTRATION"),
      form = donationForm(v.paymentOn || v.issuedOn);
    if (
      approval.kind !== "DONATION_APPROVAL" ||
      !approval.reviewed ||
      String(approval.validFrom) > v.paymentOn ||
      String(approval.validTo) < v.paymentOn ||
      !approval.orderDate ||
      approval.section !== form.section
    )
      throw new DocumentsError(
        "Select a reviewed donation approval valid on the donation date and for its deduction section.",
      );
    if (
      !v.paymentOn ||
      !v.portalReference ||
      !v.donorId ||
      !v.donorIdType ||
      !v.partyAddress ||
      !v.deductionSection ||
      v.deductionSection !== form.section ||
      !details.pan
    )
      throw new DocumentsError(
        "Complete donor identity, PAN, deduction section and the imported acknowledgement or Pre-ARN.",
      );
    if (
      v.paymentMode === "IN_KIND" ||
      (v.paymentMode === "CASH" && v.cashMinor > 200000)
    )
      throw new DocumentsError(
        "This donation cannot carry an ordinary donation-deduction certificate.",
      );
    if (!v.paymentMode || !v.paymentReference || v.cashMinor <= 0)
      throw new DocumentsError(
        "Complete the underlying donation payment facts.",
      );
    donationReportingCodes(
      v.paymentOn,
      v.donorIdType,
      v.donationCategory,
      v.paymentMode,
    );
    registration.approval = approval;
    registration.form = form;
  }
  if (
    v.type === "FCRA_RECEIPT" &&
    (!v.fcraAccount ||
      !v.foreignSourceBasis ||
      !v.donorCountry ||
      registration.kind !== "FCRA" ||
      !v.exchangeBasis ||
      !v.inrMinor ||
      !v.reviewed ||
      (v.currency === "INR" && v.inrMinor !== v.cashMinor))
  )
    throw new DocumentsError(
      "Confirm the designated FCRA account, registration, source classification and INR conversion evidence.",
    );
  if (
    v.type === "VAT_INVOICE" &&
    !["GB", "EU"].includes(profile.country) &&
    profile.country === "IN"
  )
    throw new DocumentsError(
      "Choose the organisation's VAT country in settings.",
    );
  if (
    v.type === "VAT_INVOICE" &&
    (registration.kind !== "VAT" ||
      !v.supplyOn ||
      !v.partyAddress ||
      (profile.country === "GB" && !v.vatSterlingMinor))
  )
    throw new DocumentsError(
      "Complete VAT identity, tax point and sterling VAT for a UK invoice.",
    );
  if (
    v.type === "US_ACKNOWLEDGEMENT" &&
    (profile.country !== "US" || !v.benefits)
  )
    throw new DocumentsError(
      "Use a US organisation profile and record the goods or services supplied in return, including none.",
    );
  if (
    ["CSR_UC", "GOVERNMENT_UC"].includes(v.type) &&
    (!v.periodStart ||
      !v.periodEnd ||
      v.periodEnd < v.periodStart ||
      !v.sanction ||
      !v.schedules ||
      !v.outcomes ||
      !fundId ||
      !v.reviewed)
  )
    throw new DocumentsError(
      "Link a fund and complete the reviewed period, sanction, schedules and certifications.",
    );
}
