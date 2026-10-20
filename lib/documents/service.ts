import "server-only";
import { planRefund, refundState } from "./refunds";
import {
  resolveNoteAllocations,
  creditsByInvoice,
  frozenNoteAllocations,
} from "./corrections";
import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import {
  lockFinance,
  assertOpen,
  financeAccess,
} from "@/lib/finance/tools/access";
import { uploadWorkspaceFile, deleteObjects, getObject } from "@/lib/storage";
import {
  documentsAccess,
  getDocument,
  lockDocuments,
  DocumentsError,
  type DocumentsActor,
} from "./access";
import {
  calculate,
  draftSchema,
  financialYear,
  serialNumber,
  LETTERS,
  GST_TYPES,
  RECEIPTS,
  ALLOCATABLE_RECEIPTS,
  INVOICES,
  profileSchema,
  registrationSchema,
  signatorySchema,
  itemSchema,
  templateSchema,
  donationForm,
  donationReportingCodes,
  mergeLetter,
  type DraftInput,
  type Calculation,
  type TaxProfile,
} from "./rules";
import { makeDocumentPdf } from "./pdf";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const object = (v: unknown) =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const date = (s: string) => new Date(`${s}T00:00:00Z`);
export async function audit(
  actor: DocumentsActor,
  action: string,
  id: string,
  tx: DbClient = prisma,
) {
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `documents.${action}`,
    targetType: "business_document",
    targetId: id,
    client: tx,
  });
}
export async function getSettings(
  actor: DocumentsActor,
  tx: DbClient = prisma,
) {
  await documentsAccess(actor, undefined, tx);
  const entity = await tx.governanceRecord.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      kind: "LEGAL_ENTITY",
      archivedAt: null,
    },
  });
  const details = object(entity?.details);
  const profile = profileSchema.parse({
    country: "IN",
    fiscalStartMonth: 4,
    ...object(details.documents),
  });
  const references = await tx.documentReference.findMany({
    where: {
      workspaceId: actor.workspace.id,
      archivedAt: null,
      kind: { in: ["REGISTRATION", "SIGNATORY", "ITEM", "TEMPLATE"] },
    },
    orderBy: { name: "asc" },
  });
  return { entity, details, profile, references };
}
export async function saveSettings(actor: DocumentsActor, raw: unknown) {
  await documentsAccess(actor);
  const profile = profileSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
    await documentsAccess(actor, undefined, tx);
    const { entity, details } = await getSettings(actor, tx);
    if (!entity)
      throw new DocumentsError("Add your legal entity in Governance first.");
    for (const fileId of [profile.logoFileId])
      if (
        fileId &&
        !(await tx.documentFile.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fileId,
            kind: "PROFILE",
            documentId: null,
          },
        }))
      )
        throw new DocumentsError(
          "Upload the logo in Documents settings first.",
        );
    await tx.governanceRecord.update({
      where: { id: entity.id, workspaceId: actor.workspace.id },
      data: { details: json({ ...details, documents: profile }) },
    });
    await audit(actor, "settings_saved", entity.id, tx);
    return entity.id;
  });
}
export async function saveReference(
  actor: DocumentsActor,
  kind: string,
  name: string,
  raw: unknown,
  id?: string,
) {
  await documentsAccess(actor);
  const schemas = {
    REGISTRATION: registrationSchema,
    SIGNATORY: signatorySchema,
    ITEM: itemSchema,
    TEMPLATE: templateSchema,
  };
  if (!Object.hasOwn(schemas, kind))
    throw new DocumentsError("Choose a reference type.");
  const data = schemas[kind as keyof typeof schemas].parse(raw);
  if (!name.trim() || name.length > 200)
    throw new DocumentsError("Enter a reference name.");
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await documentsAccess(actor, undefined, tx);
    if (kind === "SIGNATORY") {
      const fid = object(data).signatureFileId;
      if (
        typeof fid === "string" &&
        fid &&
        !(await tx.documentFile.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fileId: fid,
            kind: "PROFILE",
            documentId: null,
          },
        }))
      )
        throw new DocumentsError(
          "Upload the signature in Documents settings first.",
        );
    }
    const row = id
      ? await tx.documentReference.findFirst({
          where: { workspaceId: actor.workspace.id, id, kind },
        })
      : null;
    if (id && !row) throw new DocumentsError("That reference is unavailable.");
    const saved = await tx.documentReference.upsert({
      where: { id: row?.id ?? "__new__" },
      create: {
        workspaceId: actor.workspace.id,
        kind,
        name: name.trim(),
        data: json(data),
        createdById: actor.user.id,
      },
      update: { name: name.trim(), data: json(data) },
    });
    await audit(actor, "reference_saved", saved.id, tx);
    return saved.id;
  });
}
async function validateSources(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
) {
  const workspaceId = actor.workspace.id;
  if (
    v.contactId &&
    !(await tx.contact.findFirst({
      where: { id: v.contactId, workspaceId, deletedAt: null },
    }))
  )
    throw new DocumentsError("Choose a CRM contact in this workspace.");
  if (
    v.organisationId &&
    !(await tx.organisation.findFirst({
      where: { id: v.organisationId, workspaceId, deletedAt: null },
    }))
  )
    throw new DocumentsError("Choose a CRM organisation in this workspace.");
  if (
    v.personId &&
    !(await tx.memberProfile.findFirst({
      where: { workspaceId, userId: v.personId },
    }))
  )
    throw new DocumentsError("Choose a person in this workspace.");
  const where = { workspaceId, id: v.sourceId };
  let source: unknown;
  if (v.sourceType === "INVOICE")
    source = await tx.invoice.findFirst({ where });
  if (v.sourceType === "LEDGER")
    source = await tx.ledgerEntry.findFirst({
      where: { ...where, privatePayroll: false, voidedAt: null },
    });
  if (v.sourceType === "FUND")
    source = await tx.financeFund.findFirst({
      where: { ...where, archivedAt: null },
    });
  if (v.sourceType === "DEAL") source = await tx.deal.findFirst({ where });
  if (v.sourceType === "CONTRACT")
    source = await tx.governanceRecord.findFirst({
      where: { ...where, kind: "CONTRACT", archivedAt: null },
    });
  if (v.sourceType === "PAY_RUN") {
    await financeAccess(actor, "PAY_MANAGE", tx);
    source = await tx.financePayRun.findFirst({ where });
  }
  if (v.sourceType === "FUNDING")
    source = await tx.fundingRecord.findFirst({
      where: {
        ...where,
        archivedAt: null,
        kind: { in: ["DONATION", "GRANT"] },
      },
    });
  if (v.sourceType && !source)
    throw new DocumentsError("Choose a source record in this workspace.");
  if (v.parentId) {
    const parent = await getDocument(actor, v.parentId, tx);
    if (
      !["ISSUED", "CANCELLED"].includes(parent.status) ||
      parent.currency !== v.currency
    )
      throw new DocumentsError(
        "Choose an issued original in the same currency.",
      );
  }
}
export async function saveDraft(actor: DocumentsActor, raw: unknown) {
  const v = draftSchema.parse(raw);
  if (v.type === "PAYSLIP")
    throw new DocumentsError(
      "Generate the paid payslip from Payroll so it uses the approved run.",
    );
  await documentsAccess(actor, v.type);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    await documentsAccess(actor, v.type, tx);
    await validateSources(actor, v, tx);
    if (v.id) {
      const old = await getDocument(actor, v.id, tx);
      if (old.status !== "DRAFT")
        throw new DocumentsError(
          "Issued or reserved documents cannot be edited. Create a linked correction.",
        );
    }
    const row = await tx.businessDocument.upsert({
      where: { id: v.id || "__new__" },
      create: {
        workspaceId: actor.workspace.id,
        type: v.type,
        title: v.title,
        issuedOn: date(v.issuedOn),
        dueOn: v.dueOn ? date(v.dueOn) : null,
        currency: v.currency,
        ownerId: actor.user.id,
        registrationId: v.registrationId,
        input: json(v),
        sourceType: v.sourceType || null,
        sourceId: v.sourceId || null,
        parentId: v.parentId || null,
      },
      update: {
        type: v.type,
        title: v.title,
        issuedOn: date(v.issuedOn),
        dueOn: v.dueOn ? date(v.dueOn) : null,
        currency: v.currency,
        registrationId: v.registrationId,
        input: json(v),
        sourceType: v.sourceType || null,
        sourceId: v.sourceId || null,
        parentId: v.parentId || null,
      },
    });
    await audit(actor, "draft_saved", row.id, tx);
    if (v.sourceType !== "PAY_RUN")
      await indexSearchDocument(
        {
          workspaceId: actor.workspace.id,
          entityType: "business_document",
          entityId: row.id,
          title: v.title,
          url: `/w/${actor.workspace.slug}/documents/${row.id}`,
          visibility: "PRIVATE",
          ownerId: actor.user.id,
        },
        tx,
      );
    return row.id;
  });
}
export type DocumentSnapshot = {
  version: 1;
  templateVersion: string;
  number: string;
  input: DraftInput;
  identity: Record<string, unknown>;
  profile: TaxProfile;
  registration: Record<string, unknown>;
  signatory: Record<string, unknown>;
  calculation: Calculation;
  letter: string;
  source: Record<string, unknown>;
  evidence?: Record<string, unknown>;
};
async function freeze(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
): Promise<Omit<DocumentSnapshot, "number">> {
  const { entity, details, profile, references } = await getSettings(actor, tx);
  if (
    v.irnRequired &&
    !["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type)
  )
    throw new DocumentsError(
      "Reserve IRP evidence only for an eligible invoice or tax note.",
    );
  const fundingSource =
    v.sourceType === "FUNDING"
      ? await tx.fundingRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: v.sourceId,
            archivedAt: null,
          },
        })
      : null;
  if (
    fundingSource?.kind === "DONATION" &&
    ["DONATION_RECEIPT", "FCRA_RECEIPT", "DONATION_CERTIFICATE"].includes(
      v.type,
    )
  ) {
    const gift = object(fundingSource.details),
      converted =
        v.type === "DONATION_CERTIFICATE" && fundingSource.currency !== "INR";
    if (
      fundingSource.status !== "RECEIVED" ||
      fundingSource.contactId !== v.contactId ||
      gift.mode !== v.paymentMode ||
      gift.mode === "IN_KIND" ||
      (!converted &&
        (fundingSource.currency !== v.currency ||
          fundingSource.amountMinor !== v.cashMinor)) ||
      (converted &&
        (v.currency !== "INR" ||
          v.inrMinor !== v.cashMinor ||
          !v.exchangeBasis))
    )
      throw new DocumentsError(
        "Match the received gift's donor, mode, currency and amount; retain reviewed INR conversion facts for a foreign-currency certificate.",
      );
    if (gift.foreignSource && v.type === "DONATION_RECEIPT")
      throw new DocumentsError(
        "Use an FCRA receipt and verify its designated account and registration first.",
      );
    if (
      gift.foreignSource &&
      v.type === "DONATION_CERTIFICATE" &&
      !(await tx.businessDocument.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          sourceType: "FUNDING",
          sourceId: fundingSource.id,
          type: "FCRA_RECEIPT",
          status: "ISSUED",
        },
      }))
    )
      throw new DocumentsError(
        "Issue the verified FCRA receipt before reviewing a deduction certificate for this gift.",
      );
  }
  const fundId =
    v.sourceType === "FUND"
      ? v.sourceId
      : fundingSource?.kind === "GRANT"
        ? fundingSource.fundId
        : null;

  if (
    v.sourceType === "LEDGER" &&
    [...RECEIPTS, "DONATION_CERTIFICATE", "PAYMENT_REFUND"].includes(v.type)
  ) {
    const payment = await tx.ledgerEntry.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: v.sourceId,
        privatePayroll: false,
        voidedAt: null,
      },
    });
    if (
      !payment ||
      payment.currency !== v.currency ||
      payment.amountMinor !== v.cashMinor ||
      payment.kind !== (v.type === "PAYMENT_REFUND" ? "EXPENSE" : "INCOME")
    )
      throw new DocumentsError(
        "The receipt or refund cash amount and currency must match its linked ledger payment.",
      );
  }

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
  if (
    ["CREDIT_NOTE", "DEBIT_NOTE", "REFUND_VOUCHER", "PAYMENT_REFUND"].includes(
      v.type,
    ) &&
    !v.parentId &&
    !(
      ["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) && v.noteAllocations.trim()
    )
  )
    throw new DocumentsError("Link the original document before issue.");
  if (["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type)) {
    const parent = await getDocument(actor, v.parentId, tx);
    if (
      !RECEIPTS.includes(parent.type) ||
      !v.paymentOn ||
      !v.paymentReference ||
      !v.notes ||
      v.cashMinor <= 0 ||
      v.tdsMinor !== 0
    )
      throw new DocumentsError(
        "Link an issued receipt and record the actual refund date, reference, amount and reason.",
      );
  }
  if (v.type === "REFUND_VOUCHER") {
    const parent = await getDocument(actor, v.parentId, tx);
    if (parent.type !== "RECEIPT_VOUCHER")
      throw new DocumentsError(
        "Refund vouchers require an original advance receipt voucher.",
      );
    if (
      await tx.documentAllocation.findFirst({
        where: { workspaceId: actor.workspace.id, receiptId: parent.id },
      })
    )
      throw new DocumentsError(
        "This advance was allocated. Use a reviewed credit and refund correction.",
      );
  }
  if (["PAYMENT_VOUCHER"].includes(v.type) && !v.reverseCharge)
    throw new DocumentsError(
      "Payment vouchers require reviewed reverse-charge treatment.",
    );
  if (
    RECEIPTS.includes(v.type) &&
    (!v.paymentOn ||
      !v.paymentMode ||
      !v.paymentReference ||
      v.cashMinor + v.tdsMinor === 0)
  )
    throw new DocumentsError(
      "Record payment date, mode, reference and actual cash or withholding.",
    );
  if (v.tdsMinor && !v.tdsSection)
    throw new DocumentsError("Record the withholding section.");
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
  let source: Record<string, unknown> = {};
  if (fundingSource && fundingSource.currency !== v.currency)
    source = {
      originalPayment: {
        amountMinor: fundingSource.amountMinor,
        currency: fundingSource.currency,
      },
      exchangeBasis: v.exchangeBasis,
    };
  if (fundingSource) {
    const proofs = await tx.fundingAttachment.findMany({
      where: {
        workspaceId: actor.workspace.id,
        recordId: fundingSource.id,
        file: { deletedAt: null },
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            checksum: true,
            contentType: true,
          },
        },
      },
    });
    source = {
      ...source,
      fundingId: fundingSource.id,
      proofFiles: proofs.map((p) => ({
        fileId: p.file.id,
        filename: p.file.filename,
        checksum: p.file.checksum,
        contentType: p.file.contentType,
      })),
    };
  }

  if (v.parentId) {
    const parent = await getDocument(actor, v.parentId, tx);
    source = {
      ...source,
      originalNumber: parent.number,
      originalDate: parent.issuedOn.toISOString().slice(0, 10),
    };
  }
  if (v.personId) {
    const person = await tx.memberProfile.findFirstOrThrow({
      where: { workspaceId: actor.workspace.id, userId: v.personId },
      include: { user: { select: { name: true } } },
    });
    source = {
      ...source,
      person: person.user.name,
      start: person.engagementStart?.toISOString().slice(0, 10),
      end: person.engagementEnd?.toISOString().slice(0, 10),
      engagementType: person.engagementType,
    };
  }
  if (fundId) {
    const entries = await tx.ledgerEntry.findMany({
      take: 2001,
      where: {
        workspaceId: actor.workspace.id,
        fundId,
        voidedAt: null,
        currency: v.currency,
        occurredOn: {
          gte: date(v.periodStart || v.issuedOn),
          lte: date(v.periodEnd || v.issuedOn),
        },
      },
      select: {
        id: true,
        kind: true,
        amountMinor: true,
        privatePayroll: true,
        occurredOn: true,
      },
    });
    if (entries.length > 2000)
      throw new DocumentsError(
        "Shorten the certificate period to at most 2,000 entries.",
      );
    source = {
      ...source,
      fundId,
      ...(fundingSource
        ? {
            grant: {
              id: fundingSource.id,
              title: fundingSource.title,
              awardMinor: fundingSource.amountMinor,
              details: fundingSource.details,
            },
          }
        : {}),
      schedule: [
        ...entries
          .filter((e) => !e.privatePayroll)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            amountMinor: e.amountMinor,
            date: e.occurredOn.toISOString().slice(0, 10),
          })),
        ...(entries.some((e) => e.privatePayroll)
          ? [
              {
                id: "Restricted payroll total",
                kind: "EXPENSE",
                amountMinor: entries
                  .filter((e) => e.privatePayroll)
                  .reduce((n, e) => n + e.amountMinor, 0),
                date: v.periodEnd || v.issuedOn,
              },
            ]
          : []),
      ],
      incomeMinor: entries
        .filter((e) => e.kind === "INCOME")
        .reduce((s, e) => s + e.amountMinor, 0),
      expenseMinor: entries
        .filter((e) => e.kind === "EXPENSE")
        .reduce((s, e) => s + e.amountMinor, 0),
    };
    if (
      ["CSR_UC", "GOVERNMENT_UC"].includes(v.type) &&
      (source.incomeMinor !== v.receiptsMinor + v.interestMinor ||
        source.expenseMinor !== v.expenditureMinor + v.refundsMinor)
    )
      throw new DocumentsError(
        "Receipts plus interest, and expenditure plus returned funds, must match the linked fund's period schedule. Review the ledger and period.",
      );
  }
  for (const l of v.lines)
    if (l.ruleId) {
      const rule = reference(l.ruleId, "ITEM");
      if (
        String(rule.validFrom) > (v.supplyOn || v.issuedOn) ||
        String(rule.validTo) < (v.supplyOn || v.issuedOn)
      )
        throw new DocumentsError(
          "Choose an item rate valid on the supply date.",
        );
    }
  const template = v.templateId ? reference(v.templateId, "TEMPLATE") : {};
  if (template.type && template.type !== v.type)
    throw new DocumentsError("Choose a template for this document type.");
  let letter = "";
  if (LETTERS.includes(v.type)) {
    if (
      !v.reviewed ||
      !v.role ||
      !v.startsOn ||
      (!v.letterBody && !template.body)
    )
      throw new DocumentsError(
        "Review the person's role, engagement dates and letter text.",
      );
    letter = mergeLetter(String(v.letterBody || template.body), {
      person: v.partyName,
      start: v.startsOn,
      end: v.endsOn,
      role: v.role,
      programme: v.programme,
      hours: v.hours,
      signatory: String(signatory.name),
      date: v.issuedOn,
    });
  }
  const mode =
    v.type === "VAT_INVOICE"
      ? "VAT"
      : gst && v.type !== "BILL_OF_SUPPLY"
        ? v.componentOverride ||
          (v.supplyCategory !== "DOMESTIC" ||
          registration.state !== v.placeOfSupply
            ? "INTER"
            : "INTRA")
        : "NONE";
  const noTax = ["EXPORT_WITHOUT_TAX", "SEZ_WITHOUT_TAX"].includes(
    v.supplyCategory,
  );
  const calculation = calculate(
    v.lines,
    noTax ? "NONE" : mode,
    v.currency === "INR" && v.roundRupee,
    v.reverseCharge,
  );
  if (
    !LETTERS.includes(v.type) &&
    !["CSR_UC", "GOVERNMENT_UC"].includes(v.type) &&
    !v.lines.length
  )
    throw new DocumentsError("Add at least one document line.");
  if (
    !LETTERS.includes(v.type) &&
    !v.type.endsWith("_UC") &&
    calculation.totalMinor <= 0 &&
    !(v.type === "US_ACKNOWLEDGEMENT" && v.paymentMode === "IN_KIND")
  )
    throw new DocumentsError("The document total must be greater than zero.");
  if (["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type)) {
    const allocations = await resolveNoteAllocations(
      actor.workspace.id,
      v.noteAllocations,
      v.currency,
      v.parentId,
      calculation.totalMinor,
      tx,
    );
    const credits = await creditsByInvoice(actor.workspace.id, tx);
    for (const allocation of allocations) {
      const original = await tx.businessDocument.findFirstOrThrow({
        where: { workspaceId: actor.workspace.id, id: allocation.invoiceId },
      });
      const originalInput = draftSchema.parse(original.input);
      if (
        (originalInput.partyTaxId &&
          originalInput.partyTaxId !== v.partyTaxId) ||
        (!originalInput.partyTaxId && originalInput.partyName !== v.partyName)
      )
        throw new DocumentsError(
          "A note must keep the original recipient tax identity.",
        );
      if (
        v.type === "CREDIT_NOTE" &&
        (credits.get(original.id) ?? 0) + allocation.amountMinor >
          original.totalMinor
      )
        throw new DocumentsError(
          "This correction exceeds the original amount.",
        );
    }
    source = { ...source, noteAllocations: allocations };
  }
  if (
    (RECEIPTS.includes(v.type) ||
      ["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type)) &&
    calculation.totalMinor !== v.cashMinor + v.tdsMinor
  )
    throw new DocumentsError(
      "Receipt total must equal actual cash plus withholding, without duplication.",
    );
  if (["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type)) {
    if (calculation.totalMinor !== v.cashMinor)
      throw new DocumentsError(
        "The refund total must equal the actual cash returned.",
      );
    const parent = await getDocument(actor, v.parentId, tx),
      parentInput = draftSchema.parse(parent.input);
    if (
      parent.status !== "ISSUED" ||
      parent.currency !== v.currency ||
      parentInput.partyName !== v.partyName
    )
      throw new DocumentsError(
        "Link the issued receipt for this recipient and currency.",
      );
    source = {
      ...source,
      refundAllocations: await planRefund(
        actor.workspace.id,
        parent.id,
        parentInput.cashMinor,
        v.cashMinor,
        tx,
      ),
    };
  }
  return {
    version: 1,
    templateVersion: String(template.version || "2026.1"),
    input: v,
    identity: { name: entity.title, ...details, documents: undefined },
    profile,
    registration,
    signatory,
    calculation,
    letter,
    source,
  };
}
export async function issueDocument(
  actor: DocumentsActor,
  id: string,
  options?: { client: DbClient; onStored?: (key: string) => void },
) {
  await documentsAccess(actor);
  let storageKey: string | undefined;
  try {
    const run = async (tx: DbClient): Promise<string> => {
      await lockFinance(tx, actor.workspace.id);
      const candidate = await tx.businessDocument.findFirst({
        where: { workspaceId: actor.workspace.id, id },
        select: { sourceType: true },
      });
      if (candidate?.sourceType === "FUNDING")
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
      await lockDocuments(tx, actor.workspace.id);
      const row = await getDocument(actor, id, tx);
      if (row.status === "ISSUED") return row.id;
      if (!["DRAFT", "RESERVED"].includes(row.status))
        throw new DocumentsError("Cancelled documents cannot be issued.");
      const v = draftSchema.parse(row.input);
      await documentsAccess(actor, v.type, tx);
      await validateSources(actor, v, tx);
      await assertOpen(tx, actor.workspace.id, date(v.issuedOn));
      let snapshot: DocumentSnapshot;
      if (row.status === "RESERVED")
        snapshot = row.snapshot as unknown as DocumentSnapshot;
      else {
        const frozen = await freeze(actor, v, tx);
        const fy = financialYear(
          v.issuedOn,
          frozen.profile.country === "IN" ? 4 : frozen.profile.fiscalStartMonth,
        );
        let series = await tx.documentSeries.findUnique({
          where: {
            workspaceId_type_registrationId_financialYear: {
              workspaceId: actor.workspace.id,
              type: v.type,
              registrationId: v.registrationId,
              financialYear: fy,
            },
          },
        });
        if (!series) {
          const { createHash } = await import("node:crypto");
          const prefix =
            String(TYPES_PREFIX[v.type]) +
            (v.registrationId
              ? createHash("sha256")
                  .update(v.registrationId)
                  .digest("hex")
                  .slice(0, 3)
                  .toUpperCase()
              : "");
          series = await tx.documentSeries.create({
            data: {
              workspaceId: actor.workspace.id,
              type: v.type,
              registrationId: v.registrationId,
              financialYear: fy,
              prefix,
            },
          });
        }
        if (series.locked)
          throw new DocumentsError(
            "This series is locked. Review the period before issuing.",
          );
        const number = serialNumber(
          series.prefix,
          fy,
          series.nextNumber,
          series.padding,
          frozen.profile.country === "IN" && GST_TYPES.includes(v.type),
        );
        await tx.documentSeries.update({
          where: { id: series.id, workspaceId: actor.workspace.id },
          data: { nextNumber: { increment: 1 } },
        });
        snapshot = { ...frozen, number };
        await tx.businessDocument.update({
          where: { id, workspaceId: actor.workspace.id },
          data: {
            status: "RESERVED",
            number,
            financialYear: fy,
            snapshot: json(snapshot),
            totalMinor: snapshot.calculation.totalMinor,
          },
        });
        if (v.irnRequired) {
          await audit(actor, "reserved", id, tx);
          return id;
        }
      }
      if (v.irnRequired) {
        const evidence = await tx.documentReference.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            kind: "EVIDENCE",
            name: id,
          },
        });
        const e = object(evidence?.data);
        const qr = await tx.documentFile.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              documentId: id,
              kind: "IRP_QR",
            },
          }),
          signed = await tx.documentFile.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              documentId: id,
              kind: "IRP_JSON",
            },
          });
        if (
          !e.irn ||
          !e.acknowledgement ||
          !e.acknowledgementAt ||
          !qr ||
          !signed
        )
          throw new DocumentsError(
            "Add the imported IRN, acknowledgement, official signed QR and signed JSON before final issue.",
          );
        snapshot.evidence = { ...e, qrFileId: qr.fileId };
      }
      if (v.type === "CREDIT_NOTE") {
        const amounts = frozenNoteAllocations(
            snapshot,
            row.parentId,
            snapshot.calculation.totalMinor,
          ),
          credits = await creditsByInvoice(actor.workspace.id, tx);
        for (const allocation of amounts) {
          const original = await getDocument(actor, allocation.invoiceId, tx);
          if (
            original.status !== "ISSUED" ||
            (credits.get(original.id) ?? 0) + allocation.amountMinor >
              original.totalMinor
          )
            throw new DocumentsError(
              "This correction exceeds the original amount.",
            );
        }
      }
      if (v.type === "REFUND_VOUCHER" || v.type === "PAYMENT_REFUND") {
        const parent = await getDocument(actor, v.parentId, tx);
        const prior = await tx.businessDocument.aggregate({
          where: {
            workspaceId: actor.workspace.id,
            parentId: parent.id,
            type: { in: ["PAYMENT_REFUND", "REFUND_VOUCHER"] },
            status: "ISSUED",
          },
          _sum: { totalMinor: true },
        });
        if (
          (prior._sum.totalMinor ?? 0) + snapshot.calculation.totalMinor >
          (v.type === "PAYMENT_REFUND"
            ? draftSchema.parse(parent.input).cashMinor
            : parent.totalMinor)
        )
          throw new DocumentsError(
            "This correction exceeds the original amount.",
          );
      }
      const sourceProofs = Array.isArray(snapshot.source.proofFiles)
        ? (snapshot.source.proofFiles as Array<{ fileId: string }>)
        : [];
      for (const proof of sourceProofs) {
        const retained = await tx.documentFile.findUnique({
          where: {
            workspaceId_fileId: {
              workspaceId: actor.workspace.id,
              fileId: proof.fileId,
            },
          },
        });
        if (!retained)
          await tx.documentFile.create({
            data: {
              workspaceId: actor.workspace.id,
              documentId: id,
              fileId: proof.fileId,
              kind: "SOURCE",
            },
          });
      }
      const body = await makeDocumentPdf(snapshot, async (fileId) => {
        const f = await tx.documentFile.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fileId,
            kind: { in: ["PROFILE", "IRP_QR"] },
          },
          include: { file: true },
        });
        return f ? await getObject(f.file.storageKey) : null;
      });
      const upload = await uploadWorkspaceFile({
        workspaceId: actor.workspace.id,
        uploadedById: actor.user.id,
        file: new File(
          [new Uint8Array(body)],
          `${snapshot.number.replaceAll("/", "-")}.pdf`,
          { type: "application/pdf" },
        ),
        folder: "/documents/pdf",
        allowedTypes: new Set(["application/pdf"]),
        client: tx,
      });
      if (!upload.ok) throw new DocumentsError(upload.error);
      storageKey = upload.file.storageKey;
      options?.onStored?.(storageKey);
      await tx.documentFile.create({
        data: {
          workspaceId: actor.workspace.id,
          documentId: id,
          kind: "PDF",
          fileId: upload.file.id,
        },
      });
      if (v.type === "DONATION_CERTIFICATE") {
        const form = donationForm(v.paymentOn),
          reference = await tx.documentReference.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              kind: "PRE_ARN",
              name: `${form.certificate}:${v.portalReference}`,
            },
          });
        if (v.portalReferenceType === "PRE_ARN" && !reference)
          throw new DocumentsError(
            "Register the imported Pre-ARN in Documents settings first.",
          );
        if (
          v.portalReferenceType === "CERTIFICATE_ACK" &&
          !(await tx.documentFile.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              documentId: id,
              kind: "OFFICIAL_CERTIFICATE",
            },
          }))
        )
          throw new DocumentsError(
            "Upload the official portal certificate before recording its acknowledgement.",
          );
        if (v.portalReferenceType === "PRE_ARN" && reference) {
          const pre = object(reference.data);
          if (pre.donationYear !== financialYear(v.paymentOn))
            throw new DocumentsError(
              "This Pre-ARN belongs to a different donation year.",
            );
          if (pre.status !== "UNUSED" && pre.documentId !== id)
            throw new DocumentsError(
              "This Pre-ARN was already consumed by another certificate.",
            );
          await tx.documentReference.update({
            where: { workspaceId: actor.workspace.id, id: reference.id },
            data: {
              data: json({ ...pre, status: "CONSUMED", documentId: id }),
            },
          });
        }
        const used = await tx.businessDocument.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: { not: id },
            type: "DONATION_CERTIFICATE",
            status: { in: ["ISSUED", "CANCELLED"] },
            input: { path: ["portalReference"], equals: v.portalReference },
          },
        });
        if (v.portalReferenceType === "PRE_ARN" && used)
          throw new DocumentsError(
            "This portal acknowledgement or Pre-ARN is already in use.",
          );
      }
      await (
        await import("./funding")
      ).publishFundingReceipt(
        actor,
        v,
        id,
        upload.file.id,
        snapshot.number,
        tx,
      );
      await tx.businessDocument.update({
        where: { id, workspaceId: actor.workspace.id },
        data: {
          status: "ISSUED",
          snapshot: json(snapshot),
          issuedAt: new Date(),
          issuedById: actor.user.id,
        },
      });
      if (v.sourceId)
        await tx.recordLink.upsert({
          where: {
            workspaceId_fromType_fromId_toType_toId: {
              workspaceId: actor.workspace.id,
              fromType: "business_document",
              fromId: id,
              toType: v.sourceType,
              toId: v.sourceId,
            },
          },
          create: {
            workspaceId: actor.workspace.id,
            fromType: "business_document",
            fromId: id,
            toType: v.sourceType,
            toId: v.sourceId,
            createdById: actor.user.id,
          },
          update: {},
        });
      if (["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type))
        for (const allocation of frozenNoteAllocations(
          snapshot,
          row.parentId,
          snapshot.calculation.totalMinor,
        ))
          await tx.recordLink.upsert({
            where: {
              workspaceId_fromType_fromId_toType_toId: {
                workspaceId: actor.workspace.id,
                fromType: "business_document",
                fromId: id,
                toType: "business_document",
                toId: allocation.invoiceId,
              },
            },
            create: {
              workspaceId: actor.workspace.id,
              fromType: "business_document",
              fromId: id,
              toType: "business_document",
              toId: allocation.invoiceId,
              label: "Correction",
              createdById: actor.user.id,
            },
            update: {},
          });
      await audit(actor, "issued", id, tx);
      await recordActivity(
        {
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          verb: "issued",
          entityType: "business_document",
          entityId: id,
          summary: "issued a document",
          visibility: "PRIVATE",
        },
        tx,
      );
      return id;
    };
    return options?.client
      ? await run(options.client)
      : await prisma.$transaction(run, { timeout: 60000 });
  } catch (e) {
    if (storageKey) await deleteObjects([storageKey]).catch(() => undefined);
    throw e;
  }
}
const TYPES_PREFIX: Record<string, string> = {
  COMMERCIAL_INVOICE: "CI",
  TAX_INVOICE: "TI",
  BILL_OF_SUPPLY: "BS",
  RECEIPT_VOUCHER: "RV",
  REFUND_VOUCHER: "RF",
  PAYMENT_VOUCHER: "PV",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
  PAYMENT_RECEIPT: "PR",
  PAYMENT_REFUND: "PF",
  DONATION_RECEIPT: "DR",
  DONATION_CERTIFICATE: "DC",
  FCRA_RECEIPT: "FC",
  CSR_UC: "CU",
  GOVERNMENT_UC: "GU",
  APPOINTMENT: "AP",
  VOLUNTEER: "VL",
  INTERNSHIP: "IN",
  EXPERIENCE: "EX",
  NOC: "NC",
  PARTICIPATION: "PC",
  VAT_INVOICE: "VI",
  US_ACKNOWLEDGEMENT: "US",
  GENERIC_RECEIPT: "GR",
};
export async function cancelDocument(
  actor: DocumentsActor,
  id: string,
  reason: string,
) {
  if (reason.trim().length < 5 || reason.length > 1000)
    throw new DocumentsError(
      "Record a cancellation reason of 5–1,000 characters.",
    );
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await lockDocuments(tx, actor.workspace.id);
    const row = await getDocument(actor, id, tx);
    if (row.status === "CANCELLED") return id;
    if (row.status === "DRAFT")
      throw new DocumentsError(
        "Only reserved or issued documents can be cancelled.",
      );
    if (
      await tx.documentAllocation.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          OR: [{ invoiceId: id }, { receiptId: id }],
        },
      })
    )
      throw new DocumentsError(
        "Retain settled documents. Record a linked correction and refund instead.",
      );
    if (
      await tx.businessDocument.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          parentId: id,
          status: "ISSUED",
          type: { in: ["PAYMENT_REFUND", "REFUND_VOUCHER"] },
        },
        select: { id: true },
      })
    )
      throw new DocumentsError(
        "Retain refunded receipts. Review the linked refund before cancelling its source.",
      );
    await assertOpen(tx, actor.workspace.id, row.issuedOn);
    await tx.businessDocument.update({
      where: { id, workspaceId: actor.workspace.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: actor.user.id,
        cancelReason: reason.trim(),
      },
    });
    await audit(actor, "cancelled", id, tx);
    return id;
  });
}
export async function saveEvidence(
  actor: DocumentsActor,
  id: string,
  raw: unknown,
) {
  const { z } = await import("zod");
  const data = z
    .object({
      irn: z.string().regex(/^[a-fA-F0-9]{64}$/),
      acknowledgement: z.string().min(1).max(100),
      acknowledgementAt: z.iso.datetime(),
      externalCancellation: z.string().max(1000).default(""),
    })
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    const row = await getDocument(actor, id, tx);
    if (row.status !== "RESERVED")
      throw new DocumentsError(
        "Record IRP evidence against a reserved document.",
      );
    const old = await tx.documentReference.findFirst({
      where: { workspaceId: actor.workspace.id, kind: "EVIDENCE", name: id },
    });
    await tx.documentReference.upsert({
      where: { id: old?.id ?? "__new__" },
      create: {
        workspaceId: actor.workspace.id,
        kind: "EVIDENCE",
        name: id,
        data: json(data),
      },
      update: { data: json(data) },
    });
    await audit(actor, "evidence_saved", id, tx);
    return id;
  });
}
export async function allocatePayment(actor: DocumentsActor, raw: unknown) {
  const { z } = await import("zod");
  const v = z
    .object({
      receiptId: z.string().min(1).max(64),
      invoiceId: z.string().min(1).max(64),
      cashMinor: z.number().int().min(0).max(2147483647),
      tdsMinor: z.number().int().min(0).max(2147483647),
      key: z.string().uuid(),
    })
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await lockDocuments(tx, actor.workspace.id);
    const receipt = await getDocument(actor, v.receiptId, tx),
      invoice = await getDocument(actor, v.invoiceId, tx);
    const prior = await tx.documentAllocation.findUnique({
      where: {
        workspaceId_key: { workspaceId: actor.workspace.id, key: v.key },
      },
    });
    if (prior) {
      if (
        prior.receiptId !== v.receiptId ||
        prior.invoiceId !== v.invoiceId ||
        prior.cashMinor !== v.cashMinor ||
        prior.tdsMinor !== v.tdsMinor
      )
        throw new DocumentsError(
          "This retry belongs to a different allocation.",
        );
      return prior.id;
    }
    if (
      receipt.status !== "ISSUED" ||
      invoice.status !== "ISSUED" ||
      !ALLOCATABLE_RECEIPTS.includes(receipt.type) ||
      !INVOICES.includes(invoice.type) ||
      receipt.currency !== invoice.currency ||
      v.cashMinor + v.tdsMinor === 0
    )
      throw new DocumentsError(
        "Choose an issued receipt and invoice in the same currency.",
      );
    const receiptParty = draftSchema.parse(receipt.input),
      invoiceParty = draftSchema.parse(invoice.input);
    if (
      (receiptParty.contactId &&
        receiptParty.contactId !== invoiceParty.contactId) ||
      (receiptParty.organisationId &&
        receiptParty.organisationId !== invoiceParty.organisationId) ||
      (receiptParty.partyTaxId &&
        receiptParty.partyTaxId !== invoiceParty.partyTaxId) ||
      receiptParty.partyName !== invoiceParty.partyName
    )
      throw new DocumentsError(
        "Allocate a receipt to an invoice for the same recipient.",
      );
    const input = draftSchema.parse(receipt.input),
      r = await tx.documentAllocation.aggregate({
        where: { workspaceId: actor.workspace.id, receiptId: receipt.id },
        _sum: { cashMinor: true, tdsMinor: true },
      }),
      i = await tx.documentAllocation.aggregate({
        where: { workspaceId: actor.workspace.id, invoiceId: invoice.id },
        _sum: { cashMinor: true, tdsMinor: true },
      });
    const credited =
      (await creditsByInvoice(actor.workspace.id, tx)).get(invoice.id) ?? 0;
    const refunds = await refundState(actor.workspace.id, tx),
      returned = refunds.receipts.get(receipt.id);

    if (
      (r._sum.cashMinor ?? 0) - (returned?.allocated ?? 0) + v.cashMinor >
        input.cashMinor - (returned?.total ?? 0) ||
      (r._sum.tdsMinor ?? 0) + v.tdsMinor > input.tdsMinor ||
      (i._sum.cashMinor ?? 0) -
        (refunds.invoices.get(invoice.id) ?? 0) +
        (i._sum.tdsMinor ?? 0) +
        v.cashMinor +
        v.tdsMinor >
        invoice.totalMinor - credited
    )
      throw new DocumentsError(
        "The allocation exceeds the receipt or invoice balance.",
      );
    await assertOpen(
      tx,
      actor.workspace.id,
      date(input.paymentOn || input.issuedOn),
    );
    const row = await tx.documentAllocation.create({
      data: {
        ...v,
        workspaceId: actor.workspace.id,
        createdById: actor.user.id,
      },
    });
    await audit(actor, "payment_allocated", invoice.id, tx);
    return row.id;
  });
}
