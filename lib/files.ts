import "server-only";

import { prisma } from "@/lib/db";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";

/**
 * Can `userId` download file `fileId`? Requires an ACTIVE membership in the
 * file's workspace (non-archived). Files attached to admin-only docs need
 * ADMIN; ledger receipts follow the finance visibility rule. Returns the file
 * or null (callers answer 404 either way, so ids never reveal anything).
 */
export async function findDownloadableFile(fileId: string, userId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return null;
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: {
      id: true, workspaceId: true, storageKey: true, filename: true, contentType: true, size: true, deletedAt: true,
      doc: { select: { visibility: true } },
      _count: { select: { ledgerReceipts: true } },
      workspace: { select: { archivedAt: true, financeVisibleToMembers: true } },
    },
  });
  if (!file || file.deletedAt || file.workspace.archivedAt) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: file.workspaceId } },
    select: { role: true, status: true },
  });
  if (!membership || membership.status !== "ACTIVE") return null;
  if (file.doc?.visibility === "ADMINS" && !hasRoleAtLeast(membership.role, "ADMIN")) return null;
  if (file._count.ledgerReceipts > 0 && !canViewFinance(membership, file.workspace)) return null;
  return file;
}
