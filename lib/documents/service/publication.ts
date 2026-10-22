import "server-only";
import { recordActivity } from "@/lib/activity";
import { type DbClient } from "@/lib/db";
import { DocumentsError, type DocumentsActor } from "../access";
import { frozenNoteAllocations } from "../corrections";
import { donationForm, financialYear, type DraftInput } from "../rules";
import { audit, json, object } from "./shared";
import type { DocumentSnapshot } from "../service";

export async function publishDocument(
  actor: DocumentsActor,
  v: DraftInput,
  id: string,
  snapshot: DocumentSnapshot,
  parentId: string | null,
  fileId: string,
  tx: DbClient,
) {
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
    await import("../funding")
  ).publishFundingReceipt(
    actor,
    v,
    id,
    fileId,
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
      parentId,
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
}
