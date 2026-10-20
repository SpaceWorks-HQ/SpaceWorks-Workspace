import "server-only";

import { prisma } from "@/lib/db";
import { decideAccess } from "@/lib/chat/access";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { isApproverOf } from "@/lib/approvals/engine";

/**
 * Can `userId` download file `fileId`? Requires an ACTIVE membership in the
 * file's workspace (non-archived). Files attached to admin-only docs need
 * ADMIN; task attachments in a private team's project need that team;
 * purchase-request and reimbursement receipts are limited to the requester,
 * admins and that request's approvers; ledger receipts follow the finance
 * visibility rule; chat attachments
 * need read access to a channel the file was posted in. Returns the file
 * or null (callers answer 404 either way, so ids never reveal anything).
 */
export async function findDownloadableFile(fileId: string, userId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fileId)) return null;
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: {
      id: true, workspaceId: true, storageKey: true, filename: true, contentType: true, size: true, deletedAt: true, folder: true,
      governanceAttachments: { select: { record: { select: { archivedAt: true } } } },
      doc: { select: { visibility: true } },
      task: { select: { project: { select: { teamId: true } } } },
      _count: { select: { ledgerReceipts: true } },
      messageAttachments: { select: { message: { select: { channel: { select: { id: true, kind: true, teamId: true, archivedAt: true } } } } } },
      workspace: { select: { archivedAt: true, financeVisibleToMembers: true } },
    },
  });
  if (!file || file.deletedAt || file.workspace.archivedAt) return null;
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: file.workspaceId } },
    select: { role: true, status: true, user: { select: { disabledAt: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.user.disabledAt) return null;
  if (file.folder === "/governance" || file.folder.startsWith("/governance/") || file.governanceAttachments.length) {
    if (!hasRoleAtLeast(membership.role, "ADMIN")) return null;
  }
  if (file.doc?.visibility === "ADMINS" && !hasRoleAtLeast(membership.role, "ADMIN")) return null;
  const taskTeamId = file.task?.project?.teamId;
  if (taskTeamId && (await hiddenTeamIds(file.workspaceId, { userId, role: membership.role })).includes(taskTeamId)) return null;
  if (!(await canReadRequestReceipt(file.id, file.workspaceId, userId, membership.role))) return null;
  if (file._count.ledgerReceipts > 0 && !canViewFinance(membership, file.workspace)) return null;
  if (file.messageAttachments.length > 0 && !(await canReadAnyChannel(file.workspaceId, userId, membership.role, file.messageAttachments.map((a) => a.message.channel)))) return null;
  return file;
}

async function canReadAnyChannel(
  workspaceId: string,
  userId: string,
  role: Parameters<typeof hasRoleAtLeast>[0],
  channels: Array<{ id: string; kind: Parameters<typeof decideAccess>[0]["kind"]; teamId: string | null; archivedAt: Date | null }>,
): Promise<boolean> {
  const memberOf = new Set(
    (await prisma.channelMember.findMany({ where: { userId, channelId: { in: channels.map((c) => c.id) } }, select: { channelId: true } })).map((m) => m.channelId),
  );
  const hidden = channels.some((c) => c.teamId) ? await hiddenTeamIds(workspaceId, { userId, role }) : [];
  return channels.some((c) => decideAccess({
    kind: c.kind,
    archived: Boolean(c.archivedAt),
    isMember: memberOf.has(c.id),
    role,
    teamHidden: Boolean(c.teamId && !memberOf.has(c.id) && hidden.includes(c.teamId)),
  }).canRead);
}


async function canReadRequestReceipt(fileId: string, workspaceId: string, userId: string, role: Parameters<typeof hasRoleAtLeast>[0]): Promise<boolean> {
  const [purchases, reimbursements] = await Promise.all([
    prisma.purchaseRequest.findMany({ where: { workspaceId, fileIds: { has: fileId } }, select: { id: true, requesterId: true } }),
    prisma.reimbursement.findMany({ where: { workspaceId, receiptFileIds: { has: fileId } }, select: { id: true, claimantId: true } }),
  ]);
  if (purchases.length === 0 && reimbursements.length === 0) return true;
  if (hasRoleAtLeast(role, "ADMIN")) return true;
  if (purchases.some((p) => p.requesterId === userId) || reimbursements.some((r) => r.claimantId === userId)) return true;
  const approvals = await prisma.approvalRequest.findMany({
    where: { workspaceId, subjectId: { in: [...purchases.map((p) => p.id), ...reimbursements.map((r) => r.id)] } },
    select: { id: true, steps: true, requesterId: true, currentStep: true, workspace: { select: { id: true, slug: true, name: true, timezone: true } } },
  });
  for (const approval of approvals) {
    const actor = { user: { id: userId, name: null }, workspace: approval.workspace, membership: { role } };
    if (await isApproverOf(actor, approval)) return true;
  }
  return false;
}
