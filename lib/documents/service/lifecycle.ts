import "server-only";
import { prisma } from "@/lib/db";
import { assertOpen, lockFinance } from "@/lib/finance/tools/access";
import {
  DocumentsError,
  getDocument,
  lockDocuments,
  type DocumentsActor,
} from "../access";
import { audit, json } from "./shared";

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
