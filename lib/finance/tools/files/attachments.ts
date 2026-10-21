import "server-only";
import {
  prisma,
  type DbClient,
} from "@/lib/db";
import {
  deleteObjects,
  getObject,
  uploadWorkspaceFile,
} from "@/lib/storage";
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_TYPES,
} from "@/lib/finance/service";
import {
  attachmentTypeSchema,
  type AttachmentType,
} from "@/lib/finance/tools-rules";
import {
  FinanceError,
  lockFinance,
  recordAccess,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { recordAuditEvent } from "@/lib/audit";

export async function uploadFinanceFiles(
  actor: FinanceActor,
  type: AttachmentType,
  recordId: string,
  files: File[],
) {
  attachmentTypeSchema.parse(type);
  await recordAccess(actor, type, recordId, true);
  if (
    !files.length ||
    files.length > 10 ||
    files.reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
  )
    throw new FinanceError(
      "Choose up to ten files, 10 MB each and 24 MB altogether.",
    );
  const keys: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, actor.workspace.id);
        await recordAccess(actor, type, recordId, true, tx);
        const count = await tx.financeAttachment.count({
          where: {
            workspaceId: actor.workspace.id,
            recordType: type,
            recordId,
            file: { deletedAt: null },
            ...(type === "STAGED" ? { uploadedById: actor.user.id } : {}),
          },
        });
        if (count + files.length > 10)
          throw new FinanceError("Keep up to ten files per record.");
        const out = [];
        for (const file of files) {
          const upload = await uploadWorkspaceFile({
            workspaceId: actor.workspace.id,
            uploadedById: actor.user.id,
            file,
            folder: `/finance-tools/${type.toLowerCase()}`,
            allowedTypes: RECEIPT_TYPES,
            maxBytes: RECEIPT_MAX_BYTES,
            client: tx,
          });
          if (!upload.ok) throw new FinanceError(upload.error);
          keys.push(upload.file.storageKey);
          const attachment = await tx.financeAttachment.create({
            data: {
              workspaceId: actor.workspace.id,
              recordType: type,
              recordId,
              fileId: upload.file.id,
              uploadedById: actor.user.id,
            },
          });
          out.push({
            attachmentId: attachment.id,
            id: upload.file.id,
            filename: upload.file.filename,
            contentType: upload.file.contentType,
          });
        }
        await recordAuditEvent({
          action: "finance.files_attached",
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          targetType: type,
          targetId: recordId,
          metadata: { count: out.length },
          client: tx,
        });
        return out;
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    await deleteObjects(keys).catch(() => undefined);
    throw e;
  }
}

/** Attaching an upload can never move another member's or another record's file. */
export async function claimStagedFiles(
  tx: DbClient,
  actor: FinanceActor,
  fileIds: string[],
  type: AttachmentType,
  recordId: string,
) {
  const ids = [...new Set(fileIds)];
  if (!ids.length) return false;
  const staged = await tx.financeAttachment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      recordType: "STAGED",
      uploadedById: actor.user.id,
      fileId: { in: ids },
      file: { deletedAt: null },
    },
  });
  if (staged.length !== ids.length)
    throw new FinanceError(
      "Choose your newly uploaded files in this workspace.",
    );
  const count = await tx.financeAttachment.count({
    where: {
      workspaceId: actor.workspace.id,
      recordType: type,
      recordId,
      file: { deletedAt: null },
    },
  });
  if (count + staged.length > 10)
    throw new FinanceError("Keep up to ten files per record.");
  const moved = await tx.financeAttachment.updateMany({
    where: {
      workspaceId: actor.workspace.id,
      id: { in: staged.map((f) => f.id) },
      recordType: "STAGED",
      uploadedById: actor.user.id,
    },
    data: { recordType: type, recordId },
  });
  if (moved.count !== staged.length)
    throw new FinanceError("Those files changed. Upload them again.");
  return staged.some((f) => f.extractionUsed);
}

export async function financeAttachments(
  actor: FinanceActor,
  type: AttachmentType,
  recordId: string,
) {
  await recordAccess(actor, type, recordId);
  return prisma.financeAttachment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      recordType: type,
      recordId,
      ...(type === "STAGED" ? { uploadedById: actor.user.id } : {}),
      file: { deletedAt: null },
    },
    select: {
      id: true,
      file: { select: { id: true, filename: true, contentType: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function removeFinanceFile(
  actor: FinanceActor,
  attachmentId: string,
) {
  const row = await prisma.financeAttachment.findFirst({
    where: { id: attachmentId, workspaceId: actor.workspace.id },
  });
  if (
    !row ||
    (row.recordType === "STAGED" && row.uploadedById !== actor.user.id)
  )
    throw new FinanceError("That file is unavailable.");
  await recordAccess(
    actor,
    attachmentTypeSchema.parse(row.recordType),
    row.recordId,
    true,
  );
  await prisma.$transaction(async (tx) => {
    await recordAccess(
      actor,
      attachmentTypeSchema.parse(row.recordType),
      row.recordId,
      true,
      tx,
    );
    await tx.fileObject.updateMany({
      where: { id: row.fileId, workspaceId: actor.workspace.id },
      data: { deletedAt: new Date() },
    });
    await recordAuditEvent({
      action: "finance.file_removed",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: row.recordType,
      targetId: row.recordId,
      client: tx,
    });
  });
}

export async function stagedReceipt(actor: FinanceActor, fileId: string) {
  await recordAccess(actor, "STAGED", actor.user.id, true);
  const row = await prisma.financeAttachment.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      fileId,
      recordType: "STAGED",
      uploadedById: actor.user.id,
      file: { deletedAt: null },
    },
    include: { file: true },
  });
  if (!row)
    throw new FinanceError("Upload a receipt before extracting its details.");
  const object = await getObject(row.file.storageKey);
  if (!object)
    throw new FinanceError("That receipt couldn't be read. Upload it again.");
  return { row, body: object.body };
}
