import "server-only";

import { prisma } from "@/lib/db";
import { CHAT_FOLDER } from "@/lib/files/versions";
import { deleteObjects } from "@/lib/storage";
import { Prisma } from "@prisma/client";

import { areaOwnedFileIds, NOT_CHAT, OTHER_AREA_RELATIONS } from "./access";
import { FILE_TRASH_DAYS } from "./types";

// ───────────── Scheduled purge ─────────────

/**
 * Purge library files deleted more than 30 days ago (rows, versions and
 * objects), in small batches, skipping workspaces on legal hold. Safe to run
 * on every replica: rows are claimed under a lock (SKIP LOCKED) and deleted in
 * the same transaction; object removal afterwards is best effort.
 */
export async function purgeDeletedFiles(now: Date, batch = 50) {
  const cutoff = new Date(now.getTime() - FILE_TRASH_DAYS * 86_400_000);
  // Exclude area-owned files before LIMIT so retained receipts cannot starve
  // the library's purge batch. Recheck the references again under the locks.
  const candidates = await prisma.$queryRaw<{ id: string; workspaceId: string }[]>`
    SELECT f."id", f."workspaceId" FROM "FileObject" f
    JOIN "Workspace" w ON w.id=f."workspaceId"
    WHERE f."deletedAt" < ${cutoff} AND NOT w."legalHold"
      AND f.folder <> ${CHAT_FOLDER} AND f.folder NOT LIKE ${`${CHAT_FOLDER}/%`}
      AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" a WHERE a."fileId"=f.id)
      AND f.folder NOT LIKE '/marketing-it%' AND f.folder NOT LIKE '/marketing-assets%'
      AND NOT EXISTS (SELECT 1 FROM "MarketingItAttachment" ma WHERE ma."workspaceId"=f."workspaceId" AND ma."fileId"=f.id AND ma."fromLibrary"=false)
      AND f.folder <> '/product-ops' AND f.folder NOT LIKE '/product-ops/%'
      AND NOT EXISTS (SELECT 1 FROM "ProductAttachment" pa WHERE pa."workspaceId"=f."workspaceId" AND pa."fileId"=f.id)
      AND f.folder <> '/funding' AND f.folder NOT LIKE '/funding/%'
      AND NOT EXISTS (SELECT 1 FROM "FundingAttachment" fa WHERE fa."workspaceId"=f."workspaceId" AND fa."fileId"=f.id)
      AND f.folder <> '/calendar'
      AND NOT EXISTS (SELECT 1 FROM "CalendarEntry" c WHERE c."workspaceId"=f."workspaceId" AND f.id=ANY(c."fileIds"))
      AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."receiptFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "FinanceAttachment" r WHERE r."workspaceId"=f."workspaceId" AND r."fileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Subscription" r WHERE r."contractFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "Certification" r WHERE r."evidenceFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "StatusPage" r WHERE r."logoFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "SignatureRequest" r WHERE r."pdfFileId"=f.id)
      AND NOT EXISTS (SELECT 1 FROM "PurchaseRequest" r WHERE r."workspaceId"=f."workspaceId" AND f.id=ANY(r."fileIds"))
      AND NOT EXISTS (SELECT 1 FROM "Reimbursement" r WHERE r."workspaceId"=f."workspaceId" AND f.id=ANY(r."receiptFileIds"))
      AND NOT EXISTS (SELECT 1 FROM "Asset" r WHERE r."workspaceId"=f."workspaceId" AND f.id=ANY(r."photoFileIds"))
    ORDER BY f."deletedAt", f.id LIMIT ${batch}`;
  if (candidates.length === 0) return 0;
  const keys = await prisma.$transaction(async (tx) => {
    // Match the legal-hold writer's workspace lock, acquired before file locks.
    const workspaces = await tx.$queryRaw<{ id: string; legalHold: boolean }[]>`
      SELECT "id", "legalHold" FROM "Workspace"
      WHERE "id" IN (${Prisma.join([...new Set(candidates.map((file) => file.workspaceId))])})
      ORDER BY "id" FOR UPDATE`;
    const allowed = workspaces.filter((workspace) => !workspace.legalHold);
    if (!allowed.length) return [];
    // Re-check under a row lock so a file restored meanwhile is never purged.
    const claimed = await tx.$queryRaw<{ id: string; storageKey: string }[]>`
      SELECT "id", "storageKey" FROM "FileObject"
      WHERE "id" IN (${Prisma.join(candidates.map((file) => file.id))}) AND "deletedAt" < ${cutoff}
        AND "workspaceId" IN (${Prisma.join(allowed.map((workspace) => workspace.id))})
      FOR UPDATE SKIP LOCKED`;
    if (claimed.length === 0) return [];
    const excluded = (await Promise.all(allowed.map((workspace) => areaOwnedFileIds(workspace.id, tx)))).flat();
    const files = await tx.fileObject.findMany({ where: { id: { in: claimed.map((file) => file.id), notIn: excluded }, ...OTHER_AREA_RELATIONS, ...NOT_CHAT }, select: { id: true, storageKey: true } });
    const ids = files.map((file) => file.id);
    const versions = await tx.fileVersion.findMany({ where: { fileId: { in: ids } }, select: { storageKey: true } });
    await tx.fileObject.deleteMany({ where: { id: { in: ids } } });
    await tx.searchDocument.deleteMany({ where: { entityType: "file", entityId: { in: ids } } });
    return [...files.map((file) => file.storageKey), ...versions.map((version) => version.storageKey)];
  });
  if (keys.length) await deleteObjects(keys).catch(() => console.warn("[files] purge could not remove some objects"));
  return keys.length;
}
