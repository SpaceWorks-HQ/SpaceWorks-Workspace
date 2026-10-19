import "server-only";
import type { ApprovalHook } from "@/lib/approvals/types";
export const purchaseRequestApprovalHook: ApprovalHook = {
 noun: "purchase request", url: slug => `/w/${slug}/requests`,
 async onDecided(tx, ctx) {
  await tx.purchaseRequest.updateMany({ where: { id: ctx.request.subjectId, workspaceId: ctx.workspaceId, status: "SUBMITTED" }, data: { status: ctx.outcome === "CHANGES_REQUESTED" ? "DRAFT" : ctx.outcome === "CANCELLED" ? "CANCELLED" : ctx.outcome } });
 }
};
export const reimbursementApprovalHook: ApprovalHook = {
 noun: "reimbursement", url: slug => `/w/${slug}/requests`,
 async onDecided(tx, ctx) {
  await tx.reimbursement.updateMany({ where: { id: ctx.request.subjectId, workspaceId: ctx.workspaceId, status: "SUBMITTED" }, data: { status: ctx.outcome === "CHANGES_REQUESTED" ? "DRAFT" : ctx.outcome === "CANCELLED" ? "CANCELLED" : ctx.outcome } });
 }
};
