import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { DocumentsError, type DocumentsActor } from "../access";
import { type DraftInput } from "../rules";
import { audit, object } from "../service";

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
