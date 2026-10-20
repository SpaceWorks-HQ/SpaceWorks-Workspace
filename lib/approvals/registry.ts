import "server-only";
import { releaseApprovalHook, changeApprovalHook } from "@/lib/productOps/approvalHooks";

import type { ApprovalSubjectType } from "@prisma/client";
import type { ApprovalHook } from "@/lib/approvals/types";
import { purchaseRequestApprovalHook, reimbursementApprovalHook } from "@/lib/requests/approvalHooks";
import { vaultAccessApprovalHook } from "@/lib/vault/approvalHooks";

/**
 * Subject hooks, one per ApprovalSubjectType that uses the engine. Other
 * areas add theirs here at merge time (one import + one line), e.g.
 * people-relationships: `TIME_OFF: timeOffApprovalHook`. Subject types
 * without a hook still work: decisions are recorded and notified, and the
 * owning area reads `ApprovalRequest.status`.
 */
const HOOKS: Partial<Record<ApprovalSubjectType, ApprovalHook>> = {
  PRODUCT_RELEASE: releaseApprovalHook,
  PRODUCT_CHANGE: changeApprovalHook,
  PURCHASE_REQUEST: purchaseRequestApprovalHook,
  REIMBURSEMENT: reimbursementApprovalHook,
  VAULT_ACCESS: vaultAccessApprovalHook,
};

const FALLBACK: ApprovalHook = {
  noun: "request",
  url: (slug) => `/w/${slug}/requests/approvals`,
};

export function approvalHook(subjectType: ApprovalSubjectType): ApprovalHook {
  return HOOKS[subjectType] ?? FALLBACK;
}
