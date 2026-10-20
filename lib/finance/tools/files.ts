import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { deleteObjects, getObject, uploadWorkspaceFile } from "@/lib/storage";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@/lib/finance/service";
import {
  attachmentTypeSchema,
  type AttachmentType,
} from "@/lib/finance/tools-rules";
import {
  FinanceError,
  lockFinance,
  recordAccess,
  type FinanceActor,
} from "./access";
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

/** Authorised route guard for finance attachments, including orphaned reserved-folder files. */
export async function mayDownloadFinanceFile(
  file: { id: string; workspaceId: string; folder: string },
  userId: string,
) {
  const row = await prisma.financeAttachment.findFirst({
    where: { workspaceId: file.workspaceId, fileId: file.id },
  });
  const payrollReceipt = await prisma.ledgerEntry.findFirst({
    where: {
      workspaceId: file.workspaceId,
      receiptFileId: file.id,
      privatePayroll: true,
    },
    select: { id: true },
  });
  if (row?.recordType === "STAGED" && row.uploadedById !== userId) return false;
  if (!row && !payrollReceipt) return !file.folder.startsWith("/finance-tools");
  const member = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: file.workspaceId } },
    include: { workspace: true, user: { select: { id: true, name: true } } },
  });
  if (!member) return false;
  const actor = {
    user: member.user,
    workspace: member.workspace,
    membership: member,
  };
  try {
    if (row)
      await recordAccess(
        actor,
        attachmentTypeSchema.parse(row.recordType),
        row.recordId,
      );
    if (payrollReceipt) await recordAccess(actor, "LEDGER", payrollReceipt.id);
    return true;
  } catch (e) {
    if (e instanceof FinanceError) return false;
    throw e;
  }
}

/** Unconfirmed uploads expire after a day; committed financial proofs are never selected. */
export async function purgeExpiredStagedFiles(
  tx: DbClient,
  workspaceId: string,
  now: Date,
) {
  const candidates = await tx.$queryRaw<
    Array<{ id: string; storageKey: string }>
  >`
    SELECT f.id, f."storageKey" FROM "FileObject" f
    JOIN "FinanceAttachment" a ON a."fileId"=f.id AND a."workspaceId"=f."workspaceId"
    JOIN "Workspace" w ON w.id=f."workspaceId"
    WHERE f."workspaceId"=${workspaceId} AND a."recordType"='STAGED'
      AND a."createdAt" < ${new Date(+now - 86400000)} AND NOT w."legalHold"
      AND f."docId" IS NULL AND f."taskId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" e WHERE e."workspaceId"=${workspaceId} AND e."receiptFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "PurchaseRequest" r WHERE r."workspaceId"=${workspaceId} AND f.id=ANY(r."fileIds"))
      AND NOT EXISTS (SELECT 1 FROM "Reimbursement" r WHERE r."workspaceId"=${workspaceId} AND f.id=ANY(r."receiptFileIds"))
      AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" m JOIN "Message" msg ON msg.id=m."messageId" WHERE msg."workspaceId"=${workspaceId} AND m."fileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."workspaceId"=${workspaceId} AND s."contractFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Certification" c JOIN "CertType" ct ON ct.id=c."certTypeId" WHERE ct."workspaceId"=${workspaceId} AND c."evidenceFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "StatusPage" p WHERE p."workspaceId"=${workspaceId} AND p."logoFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "SignatureRequest" s WHERE s."workspaceId"=${workspaceId} AND s."pdfFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Asset" a WHERE a."workspaceId"=${workspaceId} AND f.id=ANY(a."photoFileIds"))
    ORDER BY a."createdAt", f.id LIMIT 50`;
  if (!candidates.length) return 0;
  await deleteObjects(candidates.map((f) => f.storageKey));
  const deleted = await tx.fileObject.deleteMany({
    where: {
      workspaceId,
      id: { in: candidates.map((f) => f.id) },
      financeAttachments: { some: { recordType: "STAGED" } },
    },
  });
  return deleted.count;
}
