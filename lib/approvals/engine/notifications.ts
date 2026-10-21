import "server-only";

import type { ApprovalSubjectType, Prisma } from "@prisma/client";
import { dispatch } from "@/lib/notify/dispatch";
import { displayName } from "@/lib/approvals/context";
import { approvalHook } from "@/lib/approvals/registry";

type Tx = Prisma.TransactionClient;
type After = () => Promise<void>;

const FINANCE_SUBJECTS: ReadonlySet<ApprovalSubjectType> = new Set(["PURCHASE_REQUEST", "REIMBURSEMENT"]);

/* ───────────── Notifications ───────────── */

export async function notifyRequested(
  tx: Tx,
  workspace: { id: string; slug: string },
  request: { id: string; subjectType: ApprovalSubjectType; subjectId: string; title: string; requesterId: string; amountMinor: number | null; currency: string | null },
  recipients: string[],
  requesterName: string,
): Promise<After> {
  const hook = approvalHook(request.subjectType);
  if (hook.canRead) {
    const readable = await Promise.all(recipients.map(id => hook.canRead!(tx, workspace.id, request.subjectId, id)));
    recipients = recipients.filter((_, index) => readable[index]);
  }
  if (recipients.length === 0) return async () => undefined;
  const base = {
    title: `${requesterName} needs your approval: ${request.title}`.slice(0, 150),
    url: hook.url(workspace.slug, request.subjectId),
    actorId: request.requesterId,
    recipients,
    resource: { type: "approval_request", id: request.id },
    actions: [{ id: "open" as const, label: "Review", url: `/w/${workspace.slug}/requests/approvals` }],
  };
  const ref = { approvalRequestId: request.id, subjectType: request.subjectType, subjectId: request.subjectId };
  const result = FINANCE_SUBJECTS.has(request.subjectType)
    ? await dispatch(workspace.id, { ...base, type: "finance.approval.requested", data: { ...ref, amountMinor: request.amountMinor, currency: request.currency } }, { tx })
    : await dispatch(workspace.id, { ...base, type: "approval.requested", data: ref }, { tx });
  return result.afterCommit;
}

export async function notifyDecided(
  tx: Tx,
  workspace: { id: string; slug: string },
  request: { id: string; subjectType: ApprovalSubjectType; subjectId: string; title: string; requesterId: string },
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
  actor: { id: string; name: string | null },
  comment: string | null,
): Promise<After> {
  const hook = approvalHook(request.subjectType);
  if (hook.canRead && !await hook.canRead(tx, workspace.id, request.subjectId, request.requesterId)) return async () => undefined;
  const verb = decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "rejected" : "asked for changes on";
  const base = {
    title: `${displayName(actor.name)} ${verb} ${request.title}`.slice(0, 150),
    body: ["VAULT_ACCESS", "SECRET_CHANGE"].includes(request.subjectType) ? undefined : comment ?? undefined,
    url: hook.url(workspace.slug, request.subjectId),
    actorId: actor.id,
    recipients: [request.requesterId],
    resource: { type: "approval_request", id: request.id },
  };
  const ref = { approvalRequestId: request.id, subjectType: request.subjectType, subjectId: request.subjectId, decision };
  const result = FINANCE_SUBJECTS.has(request.subjectType)
    ? await dispatch(workspace.id, { ...base, type: "finance.approval.decided", data: ref }, { tx })
    : await dispatch(workspace.id, { ...base, type: "approval.decided", data: ref }, { tx });
  return result.afterCommit;
}
