import "server-only";
import type { FundingRecord } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import {
  DocumentsError,
  documentsAccess,
  lockDocuments,
  type DocumentsActor,
} from "./access";
import {
  draftSchema,
  profileSchema,
  calculate,
  type DraftInput,
} from "./rules";
import { issueDocument, object, audit } from "./service";
import { localDate } from "@/lib/finance/dates";
import type { Actor } from "@/lib/funding/service";
export async function fundingDraft(
  actor: DocumentsActor,
  id: string,
  tx: DbClient = prisma,
): Promise<Partial<DraftInput>> {
  await documentsAccess(actor, undefined, tx);
  const source = await tx.fundingRecord.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id,
      archivedAt: null,
      kind: { in: ["DONATION", "GRANT"] },
    },
  });
  if (!source)
    throw new DocumentsError("Choose a donation or grant in this workspace.");
  if (source.kind === "GRANT") {
    const org = source.organisationId
      ? await tx.organisation.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: source.organisationId,
            deletedAt: null,
          },
        })
      : null;
    return {
      sourceType: "FUNDING",
      sourceId: id,
      type: "CSR_UC",
      title: `Utilisation — ${source.title}`,
      currency: source.currency,
      organisationId: org?.id ?? "",
      partyName: org?.name ?? source.title,
      partyAddress: org?.address ?? "",
      periodStart: source.dateOn?.toISOString().slice(0, 10) ?? "",
      periodEnd: source.endsOn?.toISOString().slice(0, 10) ?? "",
      sanction: source.notes,
    };
  }
  const gift = object(source.details),
    donor = await tx.contact.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: source.contactId ?? "",
        deletedAt: null,
      },
    });
  if (!donor) throw new DocumentsError("Choose a current donor contact.");
  const profile = await tx.fundingRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        kind: "DONOR",
        contactId: donor.id,
        archivedAt: null,
      },
    }),
    p = object(profile?.details);
  const emails = Array.isArray(donor.emails) ? donor.emails.map(object) : [];
  return {
    sourceType: "FUNDING",
    sourceId: id,
    type: gift.foreignSource ? "FCRA_RECEIPT" : "DONATION_RECEIPT",
    title: `Donation receipt — ${source.title}`,
    contactId: donor.id,
    currency: source.currency,
    partyName: donor.displayName,
    partyEmail: String(
      emails.find((e) => typeof e.value === "string")?.value ?? "",
    ),
    partyAddress: String(gift.donorAddress || p.address || ""),
    donorIdType: gift.pan || p.pan ? "PAN" : "",
    donorId: String(gift.pan || p.pan || ""),
    paymentOn: source.dateOn?.toISOString().slice(0, 10) ?? "",
    paymentMode: gift.mode as DraftInput["paymentMode"],
    paymentReference: String(
      gift.reference || `Not recorded; funding record ${source.id}`,
    ),
    cashMinor: gift.mode === "IN_KIND" ? 0 : source.amountMinor,
    donationCategory:
      gift.donationType === "CORPUS"
        ? "CORPUS"
        : gift.donationType === "SPECIFIC"
          ? "SPECIFIC_GRANT"
          : "VOLUNTARY",
    notes: String(gift.receiptNote || source.notes || ""),
    lines: [
      {
        description: source.title,
        quantity: "1",
        unitMinor: source.amountMinor,
        discountMinor: 0,
        rateBps: 0,
        cessBps: 0,
        exempt: false,
        exemption: "",
        ruleId: "",
        hsn: "",
        unit: "NOS",
      },
    ],
  };
}
/** Historical PDFs remain authoritative; no re-rendering or retrospective deduction claim. */
export async function retainFundingReceipt(
  actor: DocumentsActor,
  gift: FundingRecord,
  tx: DbClient,
) {
  const existing = await tx.businessDocument.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      sourceType: "FUNDING",
      sourceId: gift.id,
      type: { in: ["DONATION_RECEIPT", "FCRA_RECEIPT"] },
    },
  });
  if (existing) return existing.id;
  if (!gift.receiptFileId || !gift.receiptNumber)
    throw new DocumentsError("The original receipt is unavailable.");
  const file = await tx.fileObject.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id: gift.receiptFileId,
      deletedAt: null,
      contentType: "application/pdf",
    },
  });
  if (!file)
    throw new DocumentsError(
      "Restore the original receipt PDF before continuing.",
    );
  const input = draftSchema.parse({
    ...(await fundingDraft(actor, gift.id, tx)),
    type: "DONATION_RECEIPT",
    issuedOn: (gift.dateOn ?? gift.createdAt).toISOString().slice(0, 10),
    title: `Legacy donation receipt ${gift.receiptNumber}`,
  });
  const snapshot = {
    version: 1,
    templateVersion: "funding-legacy",
    number: gift.receiptNumber,
    input,
    identity: { name: "Legacy donation receipt — see original PDF" },
    profile: profileSchema.parse({ country: "IN" }),
    registration: {},
    signatory: {},
    calculation: calculate(input.lines, "NONE"),
    letter: "",
    source: {
      legacyArtifact: true,
      checksum: file.checksum,
      fundingId: gift.id,
    },
  };
  const row = await tx.businessDocument.create({
    data: {
      workspaceId: gift.workspaceId,
      type: "DONATION_RECEIPT",
      status: gift.status === "VOID" ? "CANCELLED" : "ISSUED",
      title: input.title,
      issuedOn: gift.dateOn ?? gift.createdAt,
      currency: gift.currency,
      number: gift.receiptNumber,
      ownerId: gift.ownerId ?? gift.createdById ?? actor.user.id,
      sourceType: "FUNDING",
      sourceId: gift.id,
      input: JSON.parse(JSON.stringify(input)),
      snapshot: JSON.parse(JSON.stringify(snapshot)),
      totalMinor: gift.amountMinor,
      issuedAt: gift.updatedAt,
      issuedById: gift.createdById,
      cancelReason:
        gift.status === "VOID"
          ? "Source donation was voided in Funding."
          : null,
    },
  });
  await tx.documentFile.create({
    data: {
      workspaceId: gift.workspaceId,
      documentId: row.id,
      kind: "PDF",
      fileId: file.id,
    },
  });
  await audit(actor, "legacy_receipt_retained", row.id, tx);
  return row.id;
}
export async function generateFundingReceipt(
  actor: Actor,
  gift: FundingRecord,
  tx: DbClient,
  onStored: (key: string) => void,
) {
  const workspace = await tx.workspace.findFirstOrThrow({
    where: { id: actor.workspace.id, archivedAt: null },
  });
  const documentsActor: DocumentsActor = {
    workspace,
    user: { id: actor.user.id, name: null },
    membership: actor.membership,
  };
  await documentsAccess(documentsActor, undefined, tx);
  await lockDocuments(tx, workspace.id);
  if (gift.receiptFileId) {
    await retainFundingReceipt(documentsActor, gift, tx);
    return;
  }
  const prior = await tx.businessDocument.findFirst({
    where: {
      workspaceId: workspace.id,
      sourceType: "FUNDING",
      sourceId: gift.id,
      type: { in: ["DONATION_RECEIPT", "FCRA_RECEIPT"] },
    },
  });
  if (prior) {
    await issueDocument(documentsActor, prior.id, { client: tx, onStored });
    return;
  }
  const settings = await tx.fundingRecord.findFirst({
    where: {
      workspaceId: workspace.id,
      kind: "RECEIPT_SETTINGS",
      key: "settings",
      archivedAt: null,
    },
  });
  const s = object(settings?.details);
  let entity = await tx.governanceRecord.findFirst({
    where: {
      workspaceId: workspace.id,
      kind: "LEGAL_ENTITY",
      archivedAt: null,
    },
  });
  if (!entity && !settings)
    throw new DocumentsError(
      "Complete the legal entity and signatory in Documents settings first.",
    );
  if (!entity)
    entity = await tx.governanceRecord.create({
      data: {
        workspaceId: workspace.id,
        kind: "LEGAL_ENTITY",
        key: "entity",
        title: String(s.organisationName),
        status: "ACTIVE",
        createdById: actor.user.id,
        details: {
          entityType: "OTHER",
          address: String(s.address ?? ""),
          pan: String(s.pan ?? ""),
          charity12a: String(s.registration12A ?? ""),
          charity80g: String(s.registration80G ?? ""),
          fcra: String(s.registrationFCRA ?? ""),
        },
      },
    });
  const today = localDate(new Date(), workspace.timezone),
    signatoryName = String(s.signatory || ""),
    name = `${signatoryName} · ${today}`;
  const signers = await tx.documentReference.findMany({
    where: { workspaceId: workspace.id, kind: "SIGNATORY", archivedAt: null },
    orderBy: { name: "asc" },
  });
  let signatory = signers.find(
    (r) =>
      String(object(r.data).validFrom) <= today &&
      String(object(r.data).validTo) >= today,
  );
  if (!signatory && !signatoryName)
    throw new DocumentsError(
      "Add an authorised signatory in document settings.",
    );
  if (!signatory)
    signatory = await tx.documentReference.create({
      data: {
        workspaceId: workspace.id,
        kind: "SIGNATORY",
        name,
        data: {
          name: signatoryName,
          designation: "Authorised signatory",
          validFrom: today,
          validTo: today,
          signatureFileId: "",
        },
        createdById: actor.user.id,
      },
    });
  const input = draftSchema.parse({
    ...(await fundingDraft(documentsActor, gift.id, tx)),
    issuedOn: today,
    signatoryId: signatory.id,
    reviewed: true,
  });
  if (input.paymentMode === "IN_KIND")
    throw new DocumentsError(
      "Keep an in-kind acknowledgement as a manual source file. Do not issue a monetary deduction certificate.",
    );
  if (input.type === "FCRA_RECEIPT")
    throw new DocumentsError(
      "Prepare this foreign-source receipt in Documents and verify the FCRA account and registration first.",
    );
  const row = await tx.businessDocument.create({
    data: {
      workspaceId: workspace.id,
      type: input.type,
      title: input.title,
      issuedOn: new Date(today),
      currency: gift.currency,
      ownerId: actor.user.id,
      sourceType: "FUNDING",
      sourceId: gift.id,
      input: JSON.parse(JSON.stringify(input)),
    },
  });
  await issueDocument(documentsActor, row.id, { client: tx, onStored });
}
export async function publishFundingReceipt(
  actor: DocumentsActor,
  input: DraftInput,
  id: string,
  fileId: string,
  number: string,
  tx: DbClient,
) {
  if (
    input.sourceType !== "FUNDING" ||
    !["DONATION_RECEIPT", "FCRA_RECEIPT"].includes(input.type)
  )
    return;
  const gift = await tx.fundingRecord.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id: input.sourceId,
      kind: "DONATION",
      status: "RECEIVED",
      archivedAt: null,
    },
  });
  if (!gift) throw new DocumentsError("That received donation is unavailable.");
  if (gift.receiptFileId && gift.receiptFileId !== fileId) {
    const original = await tx.documentFile.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        fileId: gift.receiptFileId,
        kind: "PDF",
      },
      include: { document: true },
    });
    if (
      !original?.document ||
      original.document.status !== "CANCELLED" ||
      input.parentId !== original.document.id
    )
      throw new DocumentsError(
        "This donation already has a retained receipt. Cancel it and create a linked correction.",
      );
  }
  await tx.fundingAttachment.upsert({
    where: { workspaceId_fileId: { workspaceId: actor.workspace.id, fileId } },
    create: {
      workspaceId: actor.workspace.id,
      recordId: gift.id,
      fileId,
      generated: true,
    },
    update: {},
  });
  await tx.fundingRecord.update({
    where: { workspaceId_id: { workspaceId: actor.workspace.id, id: gift.id } },
    data: {
      receiptFileId: fileId,
      receiptNumber: number,
      details: JSON.parse(
        JSON.stringify({
          ...object(gift.details),
          receiptNumber: number,
          receiptIssued: true,
        }),
      ),
    },
  });
  await audit(actor, "funding_receipt_linked", id, tx);
}
export async function assertDonorDelivery(
  workspaceId: string,
  sourceId: string,
  to: string,
  tx: DbClient = prisma,
) {
  const gift = await tx.fundingRecord.findFirst({
    where: { workspaceId, id: sourceId, archivedAt: null },
  });
  if (!gift)
    throw new DocumentsError(
      "That funding source is unavailable for delivery.",
    );
  if (gift.kind !== "DONATION") return;
  if (gift.status !== "RECEIVED")
    throw new DocumentsError("That donation is unavailable for delivery.");
  const contact = await tx.contact.findFirst({
      where: {
        workspaceId,
        id: gift.contactId ?? "",
        deletedAt: null,
        consentStatus: "GRANTED",
        preferredChannel: "EMAIL",
        doNotContact: false,
      },
    }),
    emails =
      contact && Array.isArray(contact.emails)
        ? contact.emails.map(object)
        : [];
  if (!emails.some((email) => email.value === to))
    throw new DocumentsError(
      "Confirm this donor's email consent, preference and recipient address in CRM first.",
    );
}
