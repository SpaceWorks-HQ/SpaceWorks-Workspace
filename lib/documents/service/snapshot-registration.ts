import "server-only";
import { DocumentsError } from "../access";
import { GST_TYPES, type DraftInput } from "../rules";
import { getSettings } from "./settings";
import { object } from "./shared";

export function validateSnapshotRegistration(
  v: DraftInput,
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  const { entity, details, profile, references } = settings;
  if (!entity || !details.address)
    throw new DocumentsError(
      "Complete the legal entity name and address in Governance first.",
    );
  const reference = (id: string, kind: string) => {
    const r = references.find((r) => r.id === id && r.kind === kind);
    if (!r) throw new DocumentsError(`Choose a current ${kind.toLowerCase()}.`);
    return object(r.data);
  };
  const signatory = reference(v.signatoryId, "SIGNATORY");
  if (
    String(signatory.validFrom) > v.issuedOn ||
    String(signatory.validTo) < v.issuedOn
  )
    throw new DocumentsError("The signatory is not authorised on this date.");
  const registration = v.registrationId
    ? reference(v.registrationId, "REGISTRATION")
    : {};
  if (
    v.registrationId &&
    (String(registration.validFrom) > v.issuedOn ||
      String(registration.validTo) < v.issuedOn ||
      !registration.reviewed)
  )
    throw new DocumentsError(
      "Review this registration and its validity before issue.",
    );
  if (
    profile.eInvoiceRequired &&
    ["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) &&
    (v.partyTaxId || v.supplyCategory !== "DOMESTIC") &&
    !v.irnRequired
  )
    throw new DocumentsError(
      "This profile requires IRP evidence. Mark the document for manual IRP registration.",
    );
  const gst =
    profile.country === "IN" &&
    GST_TYPES.includes(v.type) &&
    (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) || v.gstAdjustment);
  if (
    ["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) &&
    !v.gstAdjustment &&
    (!v.reviewed || !v.overrideReason)
  )
    throw new DocumentsError(
      "Review and record why this commercial adjustment does not change GST.",
    );
  if (
    gst &&
    (registration.kind !== "GST" ||
      !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(
        String(registration.identifier),
      ))
  )
    throw new DocumentsError("Choose a valid issuing GST registration.");
  if (gst && v.currency !== "INR")
    throw new DocumentsError(
      "Prepare GST values in INR. Retain the foreign-currency source and conversion evidence as attachments.",
    );
  if (gst && profile.gstScheme === "UNREGISTERED")
    throw new DocumentsError(
      "An unregistered organisation must use a generic receipt or commercial document.",
    );
  if (
    gst &&
    v.partyTaxId &&
    !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(v.partyTaxId)
  )
    throw new DocumentsError("Check the recipient GSTIN before issue.");
  if (
    gst &&
    v.supplyCategory === "DOMESTIC" &&
    !/^\d{2}$/.test(v.placeOfSupply)
  )
    throw new DocumentsError(
      "Enter the determined place-of-supply state code.",
    );
  if (
    gst &&
    details.pan &&
    String(registration.identifier).slice(2, 12) !== details.pan
  )
    throw new DocumentsError(
      "The issuing GSTIN must belong to the legal entity's PAN.",
    );
  if (
    v.type === "FCRA_RECEIPT" &&
    (String(registration.validFrom) > v.paymentOn ||
      String(registration.validTo) < v.paymentOn)
  )
    throw new DocumentsError(
      "Choose FCRA registration valid on the contribution date.",
    );
  if (gst && String(registration.identifier).slice(0, 2) !== registration.state)
    throw new DocumentsError("The issuing state must match the GSTIN.");
  if (details.entityType === "SECTION_8" && (!profile.cin || !profile.contact))
    throw new DocumentsError(
      "Complete the company's CIN and contact particulars in document settings.",
    );
  if (v.type === "PAYMENT_VOUCHER" && !v.notes)
    throw new DocumentsError(
      "Record the reviewed supplier-signature arrangement in the voucher notes.",
    );
  if (gst && !v.partyAddress)
    throw new DocumentsError("Add the recipient's address.");
  if (gst && (!v.placeOfSupply || !v.placeRule || !v.supplyOn))
    throw new DocumentsError(
      "Record supply date, place of supply and the rule used.",
    );
  if (gst && !v.reviewed)
    throw new DocumentsError(
      "Review the classification and place of supply before issue.",
    );
  if (v.type === "TAX_INVOICE" && profile.gstScheme === "COMPOSITION")
    throw new DocumentsError(
      "Use a bill of supply for the composition scheme.",
    );
  if (
    v.type === "BILL_OF_SUPPLY" &&
    v.lines.some((l) => l.rateBps || l.cessBps)
  )
    throw new DocumentsError(
      "A bill of supply cannot charge GST. Set the rates to zero.",
    );
  if (
    v.type === "BILL_OF_SUPPLY" &&
    profile.gstScheme !== "COMPOSITION" &&
    v.lines.some((l) => !l.exempt || !l.exemption)
  )
    throw new DocumentsError(
      "Record the exemption entry and conditions for each bill-of-supply line.",
    );
  if (
    gst &&
    v.lines.some((l) => !l.hsn || !l.unit || (l.exempt && !l.exemption))
  )
    throw new DocumentsError(
      "Complete HSN/SAC, unit and any exemption basis on every line.",
    );
  return { entity, reference, signatory, registration, gst };
}
