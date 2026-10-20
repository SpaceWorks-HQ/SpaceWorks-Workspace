import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
import {
  getDocument,
  lockDocuments,
  DocumentsError,
  type DocumentsActor,
} from "./access";
import { audit } from "./service";
import { escapeHtml, type RenderedEmail } from "@/lib/email/templates";
export async function queueDocumentEmail(
  actor: DocumentsActor,
  id: string,
  recipient: string,
) {
  const to = z.email().max(320).parse(recipient);
  return prisma.$transaction(async (tx) => {
    await lockDocuments(tx, actor.workspace.id);
    const row = await getDocument(actor, id, tx);
    if (row.status !== "ISSUED")
      throw new DocumentsError("Only issued documents can be emailed.");
    if (row.sourceType === "FUNDING")
      await (
        await import("./funding")
      ).assertDonorDelivery(actor.workspace.id, row.sourceId!, to, tx);
    const pdf = await tx.documentFile.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        documentId: id,
        kind: "PDF",
        file: { deletedAt: null },
      },
      include: { file: true },
    });
    if (!pdf?.file.checksum)
      throw new DocumentsError("The frozen PDF is unavailable.");
    const job = await tx.outboxMessage.create({
      data: {
        kind: "documents.email",
        payload: {
          workspaceId: actor.workspace.id,
          documentId: id,
          fileId: pdf.fileId,
          checksum: pdf.file.checksum,
          to,
          actorId: actor.user.id,
        },
      },
    });
    await tx.documentDelivery.create({
      data: {
        workspaceId: actor.workspace.id,
        documentId: id,
        fileId: pdf.fileId,
        checksum: pdf.file.checksum,
        recipient: to,
        outboxId: job.id,
        createdById: actor.user.id,
      },
    });
    await audit(actor, "email_queued", id, tx);
    return id;
  });
}
export async function renderDocumentEmail(
  raw: unknown,
): Promise<{ to: string; email: RenderedEmail }> {
  const v = z
    .object({
      workspaceId: z.string(),
      documentId: z.string(),
      fileId: z.string(),
      checksum: z.string(),
      to: z.email(),
      actorId: z.string(),
    })
    .parse(raw);
  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { id: v.workspaceId, archivedAt: null },
  });
  const actor = {
    workspace,
    user: { id: v.actorId, name: null },
    membership: { role: "GUEST" as const },
  };
  const row = await getDocument(actor, v.documentId);
  if (row.sourceType === "FUNDING")
    await (
      await import("./funding")
    ).assertDonorDelivery(v.workspaceId, row.sourceId!, v.to);
  if (row.status !== "ISSUED")
    throw new DocumentsError("This document is no longer issued.");
  const link = await prisma.documentFile.findFirstOrThrow({
    where: {
      workspaceId: v.workspaceId,
      documentId: row.id,
      fileId: v.fileId,
      kind: "PDF",
      file: { deletedAt: null, checksum: v.checksum },
    },
    include: { file: true },
  });
  const data = await getObject(link.file.storageKey);
  if (!data) throw new DocumentsError("The frozen PDF is unavailable.");
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(data.body).digest("hex") !== v.checksum)
    throw new DocumentsError("The PDF checksum does not match.");
  return {
    to: v.to,
    email: {
      subject: `${row.title} ${row.number}`,
      text: `Please find ${row.number} attached.\n${workspace.name}`,
      html: `<p>Please find ${escapeHtml(row.number!)} attached.</p><p>${escapeHtml(workspace.name)}</p>`,
      attachments: [
        {
          filename: link.file.filename,
          content: Buffer.from(data.body),
          contentType: "application/pdf",
        },
      ],
    },
  };
}
