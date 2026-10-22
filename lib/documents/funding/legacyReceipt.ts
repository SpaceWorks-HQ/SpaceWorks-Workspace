import "server-only";

import { type DbClient } from "@/lib/db";
import type { FundingRecord } from "@prisma/client";
import { DocumentsError, type DocumentsActor } from "../access";
import {
  calculate,
  draftSchema,
  profileSchema,
} from "../rules";
import { audit } from "../service";
import { fundingDraft } from "./draft";

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
