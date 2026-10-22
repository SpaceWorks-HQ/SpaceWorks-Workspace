import "server-only";

import type { ApprovalSubjectType, Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import type { DbClient } from "@/lib/db";
import { displayName } from "@/lib/approvals/context";
import {
  applicableSteps,
  DEFAULT_STEPS,
  parseSteps,
  approvalStepsSchema,
  type ApprovalState,
  type ApprovalStep,
} from "@/lib/approvals/machine";
import { OpsError } from "@/lib/approvals/ops";
import { approvalHook } from "@/lib/approvals/registry";
import { eligibleApproverIds } from "./eligibility";
import { notifyRequested } from "./notifications";

type Tx = Prisma.TransactionClient;
type After = () => Promise<void>;

/* ───────────── Request ───────────── */

export type RequestApprovalInput = {
  workspace: { id: string; slug: string };
  subjectType: ApprovalSubjectType;
  subjectId: string;
  /** Inbox title snapshot ("Filament for the print farm"). */
  title: string;
  requesterId: string;
  requesterName?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  /** A specific policy; otherwise the subject type's default policy, else one admin. */
  policyId?: string | null;
  /** Explicit chain (e.g. the vault item's owner); wins over policies. */
  steps?: ApprovalStep[];
  /** Set false when the caller sends its own "requested" event (vault access). */
  notifyApprovers?: boolean;
  now?: Date;
};

export type RequestApprovalResult = {
  requestId: string;
  status: ApprovalState;
  /** Approvers of the first step (empty when auto-approved). */
  approverIds: string[];
  afterCommit: After;
};

/** Steps for a subject: explicit, a named policy, the default policy, or one admin. */
export async function resolveSteps(client: DbClient, workspaceId: string, subjectType: ApprovalSubjectType, policyId?: string | null): Promise<{ policyId: string | null; steps: ApprovalStep[] }> {
  const policy = policyId
    ? await client.approvalPolicy.findFirst({ where: { id: policyId, workspaceId, subjectType } })
    : await client.approvalPolicy.findFirst({ where: { workspaceId, subjectType, isDefault: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (policyId && !policy) throw new OpsError("Choose an approval policy in this workspace.");
  return policy ? { policyId: policy.id, steps: parseSteps(policy.steps) } : { policyId: null, steps: DEFAULT_STEPS };
}

/**
 * Open (or reopen) the approval for a subject inside the caller's
 * transaction. Idempotent while PENDING. An amount below every step's
 * threshold approves immediately and runs the subject hook.
 */
export async function requestApproval(tx: Tx, input: RequestApprovalInput): Promise<RequestApprovalResult> {
  const now = input.now ?? new Date();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval:${input.workspace.id}:${input.subjectType}:${input.subjectId}`}))`;
  const key = { workspaceId: input.workspace.id, subjectType: input.subjectType, subjectId: input.subjectId };
  const existing = await tx.approvalRequest.findUnique({ where: { workspaceId_subjectType_subjectId: key } });
  if (existing?.status === "APPROVED") return { requestId: existing.id, status: "APPROVED", approverIds: [], afterCommit: async () => undefined };
  if (existing?.status === "PENDING") return { requestId: existing.id, status: "PENDING", approverIds: [], afterCommit: async () => undefined };

  const resolved = input.steps ? { policyId: null, steps: approvalStepsSchema.parse(input.steps) } : await resolveSteps(tx, input.workspace.id, input.subjectType, input.policyId);
  const steps = applicableSteps(resolved.steps, input.amountMinor ?? null);
  const auto = steps.length === 0;
  const data = {
    policyId: resolved.policyId,
    title: input.title.slice(0, 200),
    requesterId: input.requesterId,
    status: auto ? ("APPROVED" as const) : ("PENDING" as const),
    currentStep: 0,
    steps: steps as unknown as Prisma.InputJsonValue,
    amountMinor: input.amountMinor ?? null,
    currency: input.currency ?? null,
    lastRemindedAt: null,
    decidedAt: auto ? now : null,
  };
  let request;
  if (existing) {
    // Preserve earlier reviews under negative step numbers before restarting.
    const history = await tx.approvalDecision.aggregate({ where: { requestId: existing.id, request: { workspaceId: input.workspace.id } }, _min: { step: true } });
    const base = Math.min(-1, history._min.step ?? -1) - 6;
    for (let step = 0; step < 6; step++) await tx.approvalDecision.updateMany({ where: { requestId: existing.id, step, request: { workspaceId: input.workspace.id } }, data: { step: base + step } });
    request = await tx.approvalRequest.update({ where: { id: existing.id }, data: { ...data, createdAt: now } });
  } else {
    request = await tx.approvalRequest.create({ data: { ...key, ...data, createdAt: now } });
  }
  await recordAuditEvent({ client: tx, action: "approval.requested", workspaceId: input.workspace.id, actorId: input.requesterId, targetType: "ApprovalRequest", targetId: request.id, metadata: { subjectType: input.subjectType, steps: steps.length, autoApproved: auto } });

  if (auto) {
    await approvalHook(input.subjectType).onDecided?.(tx, {
      workspaceId: input.workspace.id,
      workspaceSlug: input.workspace.slug,
      request,
      outcome: "APPROVED",
      actorId: null,
      comment: null,
      now,
    });
    return { requestId: request.id, status: "APPROVED", approverIds: [], afterCommit: async () => undefined };
  }

  const approverIds = await eligibleApproverIds(tx, input.workspace.id, steps[0]!, input.requesterId);
  const after = input.notifyApprovers === false ? async () => undefined : await notifyRequested(tx, input.workspace, request, approverIds, displayName(input.requesterName));
  return { requestId: request.id, status: "PENDING", approverIds, afterCommit: after };
}

/** Withdraw an open approval (the subject was cancelled). No hook runs. */
export async function cancelApproval(tx: Tx, input: { workspaceId: string; subjectType: ApprovalSubjectType; subjectId: string; actorId: string | null; now?: Date }) {
  const result = await tx.approvalRequest.updateMany({
    where: { workspaceId: input.workspaceId, subjectType: input.subjectType, subjectId: input.subjectId, status: { in: ["PENDING", "CHANGES_REQUESTED"] } },
    data: { status: "CANCELLED", decidedAt: input.now ?? new Date() },
  });
  if (result.count > 0) {
    await recordAuditEvent({ client: tx, action: "approval.cancelled", workspaceId: input.workspaceId, actorId: input.actorId, targetType: input.subjectType, targetId: input.subjectId });
  }
  return result.count > 0;
}
