import "server-only";
import type { ApprovalHook } from "@/lib/approvals/types";
import { recordAuditEvent } from "@/lib/audit";
export const vaultAccessApprovalHook: ApprovalHook = {
 noun: "vault access request", url: slug => `/w/${slug}/vault`,
 async onDecided(tx, ctx) {
  const request = await tx.vaultAccessRequest.findFirst({ where: { id: ctx.request.subjectId, workspaceId: ctx.workspaceId, status: "PENDING", item: { workspaceId: ctx.workspaceId, deletedAt: null } } });
  if (!request) return;
  await tx.vaultAccessRequest.updateMany({ where: { id: request.id, workspaceId: ctx.workspaceId }, data: { status: ctx.outcome, decidedAt: ctx.now } });
  if (ctx.outcome !== "APPROVED") return;
  await tx.vaultGrant.create({ data: { workspaceId: ctx.workspaceId, itemId: request.itemId, principalType: "USER", principalId: request.requesterId, permission: request.permission, expiresAt: new Date(ctx.now.getTime() + request.durationHours * 3600000), grantedById: ctx.actorId } });
  await tx.vaultAccessLog.create({ data: { workspaceId: ctx.workspaceId, itemId: request.itemId, userId: ctx.actorId ?? request.requesterId, action: "GRANT" } });
  await recordAuditEvent({ client: tx, workspaceId: ctx.workspaceId, actorId: ctx.actorId, action: "vault.access_granted", targetType: "VaultItem", targetId: request.itemId });
 }
};
