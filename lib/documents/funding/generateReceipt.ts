import "server-only";

import { type DbClient } from "@/lib/db";
import { localDate } from "@/lib/finance/dates";
import type { Actor } from "@/lib/funding/service";
import type { FundingRecord } from "@prisma/client";
import {
  DocumentsError,
  documentsAccess,
  lockDocuments,
  type DocumentsActor,
} from "../access";
import { draftSchema } from "../rules";
import { issueDocument, object } from "../service";
import { fundingDraft } from "./draft";
import { retainFundingReceipt } from "./legacyReceipt";

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
