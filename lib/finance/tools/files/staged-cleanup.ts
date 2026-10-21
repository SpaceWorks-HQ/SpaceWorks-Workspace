import "server-only";
import { type DbClient } from "@/lib/db";
import { deleteObjects } from "@/lib/storage";

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
