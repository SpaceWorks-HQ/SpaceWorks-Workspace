import "server-only";

/**
 * Generic approvals engine. Any area can put a record through an approval
 * chain:
 *
 *   const approval = await requestApproval(tx, { workspace, subjectType, subjectId, title, requesterId, amountMinor });
 *   // after the transaction commits:
 *   await approval.afterCommit();
 *
 * Approvers decide with `decide(actor, { requestId, decision, comment })`;
 * the subject's hook (`lib/approvals/registry.ts`) runs inside the decision
 * transaction. Rules: steps run in order, nobody approves their own
 * request, rejections end it, "request changes" hands it back and a
 * resubmission (`requestApproval` again) restarts at step 0.
 */


export { eligibleApproverIds } from "./engine/eligibility";
export {
  resolveSteps,
  requestApproval,
  cancelApproval,
  type RequestApprovalInput,
  type RequestApprovalResult,
} from "./engine/requests";
export { decideInputSchema, decide, commentOnApproval } from "./engine/decisions";
export {
  getApprovalView,
  isApproverOf,
  approvalInbox,
  approvalInboxCount,
  listAllApprovals,
  type ApprovalView,
  type InboxItem,
} from "./engine/queries";
