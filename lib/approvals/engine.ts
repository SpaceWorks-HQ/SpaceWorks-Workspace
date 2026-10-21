import "server-only";

import type { ApprovalSubjectType, Prisma, WorkspaceRole } from "@prisma/client";
import { z } from "zod";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { prisma, type DbClient } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { hasRoleAtLeast } from "@/lib/roles";
import { displayName, isAdmin, type OpsActor } from "@/lib/approvals/context";
import {
  APPROVAL_DECISIONS,
  applicableSteps,
  DEFAULT_STEPS,
  decisionBlocker,
  parseSteps,
  approvalStepsSchema,
  REQUESTER_TEAMS,
  requiredApprovals,
  transition,
  type ApprovalState,
  type ApprovalStep,
} from "@/lib/approvals/machine";
import { guard, OpsError } from "@/lib/approvals/ops";
import { approvalHook } from "@/lib/approvals/registry";
import type { ApprovalOutcome } from "@/lib/approvals/types";

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

type Tx = Prisma.TransactionClient;
type After = () => Promise<void>;

const FINANCE_SUBJECTS: ReadonlySet<ApprovalSubjectType> = new Set(["PURCHASE_REQUEST", "REIMBURSEMENT"]);

/* ───────────── Eligibility ───────────── */

/**
 * Who may decide `step` of a request by `requesterId`. The requester is never
 * eligible. Missing people or empty teams leave the step pending until
 * an eligible approver is available; authority never silently broadens.
 */
export async function eligibleApproverIds(client: DbClient, workspaceId: string, step: ApprovalStep, requesterId: string): Promise<string[]> {
  const members = await client.membership.findMany({ where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } }, select: { userId: true, role: true } });
  const active = new Map(members.map((row) => [row.userId, row.role] as const));
  let ids: string[] = [];
  switch (step.approverType) {
    case "ROLE":
      ids = members.filter((row) => hasRoleAtLeast(row.role, step.ref as WorkspaceRole)).map((row) => row.userId);
      break;
    case "USER":
      ids = active.has(step.ref) ? [step.ref] : [];
      break;
    case "TEAM":
    case "TEAM_LEAD": {
      const teamIds =
        step.ref === REQUESTER_TEAMS
          ? (await client.teamMember.findMany({ where: { userId: requesterId, team: { workspaceId, archivedAt: null } }, select: { teamId: true } })).map((row) => row.teamId)
          : [step.ref];
      const rows = await client.teamMember.findMany({
        where: { teamId: { in: teamIds }, team: { workspaceId, archivedAt: null }, ...(step.approverType === "TEAM_LEAD" ? { role: "LEAD" } : {}) },
        select: { userId: true },
      });
      ids = rows.map((row) => row.userId).filter((id) => active.has(id));
      break;
    }
  }
  const eligible = [...new Set(ids)].filter((id) => id !== requesterId && active.get(id) !== "GUEST");
  return eligible;
}

/* ───────────── Notifications ───────────── */

async function notifyRequested(
  tx: Tx,
  workspace: { id: string; slug: string },
  request: { id: string; subjectType: ApprovalSubjectType; subjectId: string; title: string; requesterId: string; amountMinor: number | null; currency: string | null },
  recipients: string[],
  requesterName: string,
): Promise<After> {
  if (recipients.length === 0) return async () => undefined;
  const hook = approvalHook(request.subjectType);
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

async function notifyDecided(
  tx: Tx,
  workspace: { id: string; slug: string },
  request: { id: string; subjectType: ApprovalSubjectType; subjectId: string; title: string; requesterId: string },
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
  actor: { id: string; name: string | null },
  comment: string | null,
): Promise<After> {
  const hook = approvalHook(request.subjectType);
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

/* ───────────── Decide ───────────── */

export const decideInputSchema = z
  .object({
    requestId: z.string().trim().min(1).max(64),
    decision: z.enum(APPROVAL_DECISIONS),
    comment: z.string().trim().max(1000, "Keep the comment under 1,000 characters.").optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.decision !== "APPROVED" && !value.comment) {
      ctx.addIssue({ code: "custom", path: ["comment"], message: "Say why, so they know what to change." });
    }
  });

type DecideOutcome = { ok: true; status: ApprovalState; after: After[] } | { ok: false; error: string };

export async function decide(actor: OpsActor, input: unknown, now = new Date()): Promise<ActionResult<{ status: ApprovalState }>> {
  if (actor.membership.role === "GUEST") return actionError(NOT_ALLOWED);
  await guard(actor);
  const parsed = decideInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { requestId, decision } = parsed.data;
  const comment = parsed.data.comment || null;

  const outcome = await prisma.$transaction(async (tx): Promise<DecideOutcome> => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ApprovalRequest" WHERE "id" = ${requestId} AND "workspaceId" = ${actor.workspace.id} FOR UPDATE`;
    if (locked.length === 0) return { ok: false, error: "That request no longer exists." };
    const request = await tx.approvalRequest.findUniqueOrThrow({ where: { id: requestId, workspaceId: actor.workspace.id } });
    const steps = parseSteps(request.steps);
    const step = steps[request.currentStep] ?? steps[steps.length - 1]!;
    const eligible = new Set(await eligibleApproverIds(tx, actor.workspace.id, step, request.requesterId));
    const already = await tx.approvalDecision.findUnique({
      where: { requestId_step_approverId: { requestId, step: request.currentStep, approverId: actor.user.id } },
      select: { id: true },
    });
    const blocker = decisionBlocker({ status: request.status, actorId: actor.user.id, requesterId: request.requesterId, eligible, alreadyDecided: Boolean(already) });
    if (blocker) return { ok: false, error: blocker };

    await tx.approvalDecision.create({ data: { requestId, step: request.currentStep, approverId: actor.user.id, decision, comment } });
    const approvalsAtStep = await tx.approvalDecision.count({ where: { requestId, step: request.currentStep, decision: "APPROVED" } });
    const next = transition({ currentStep: request.currentStep, stepCount: steps.length, decision, approvalsAtStep, required: requiredApprovals(step, eligible.size) });
    await tx.approvalRequest.update({
      where: { id: requestId, workspaceId: actor.workspace.id },
      data: { status: next.status, currentStep: next.currentStep, decidedAt: next.final ? now : null },
    });
    await recordAuditEvent({
      client: tx,
      action: "approval.decided",
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      targetType: "ApprovalRequest",
      targetId: requestId,
      metadata: { subjectType: request.subjectType, decision, step: request.currentStep, status: next.status },
    });

    const after: After[] = [];
    if (next.final || next.status === "CHANGES_REQUESTED") {
      await approvalHook(request.subjectType).onDecided?.(tx, {
        workspaceId: actor.workspace.id,
        workspaceSlug: actor.workspace.slug,
        request,
        outcome: next.status as ApprovalOutcome,
        actorId: actor.user.id,
        comment,
        now,
      });
      after.push(await notifyDecided(tx, actor.workspace, request, next.status as "APPROVED" | "REJECTED" | "CHANGES_REQUESTED", actor.user, comment));
    } else if (next.advanced) {
      const nextApprovers = await eligibleApproverIds(tx, actor.workspace.id, steps[next.currentStep]!, request.requesterId);
      const requester = await tx.user.findUnique({ where: { id: request.requesterId }, select: { name: true } });
      after.push(await notifyRequested(tx, actor.workspace, request, nextApprovers, displayName(requester?.name)));
    }
    return { ok: true, status: next.status, after };
  }, { timeout: 60_000 });

  if (!outcome.ok) return actionError(outcome.error);
  for (const run of outcome.after) await run();
  return { ok: true, data: { status: outcome.status } };
}

/* ───────────── Read side ───────────── */

export type ApprovalView = {
  id: string;
  status: ApprovalState;
  currentStep: number;
  steps: ApprovalStep[];
  requesterId: string;
  createdAt: Date;
  decidedAt: Date | null;
  decisions: Array<{ step: number; approverId: string; approverName: string; decision: string; comment: string | null; createdAt: Date }>;
  /** Names of the people who can decide the current step (PENDING only). */
  waitingOn: string[];
  canDecide: boolean;
};

/** The approval for a subject as `actor` sees it, or null when there is none. */
export async function getApprovalView(actor: OpsActor, subjectType: ApprovalSubjectType, subjectId: string): Promise<ApprovalView | null> {
  await guard(actor);
  const request = await prisma.approvalRequest.findUnique({
    where: { workspaceId_subjectType_subjectId: { workspaceId: actor.workspace.id, subjectType, subjectId } },
    include: { decisions: { orderBy: { createdAt: "asc" } } },
  });
  if (!request || (!isAdmin(actor) && request.requesterId !== actor.user.id && !await isApproverOf(actor, request))) return null;
  const steps = parseSteps(request.steps);
  const pending = request.status === "PENDING";
  const eligible = pending ? await eligibleApproverIds(prisma, actor.workspace.id, steps[request.currentStep] ?? steps[0]!, request.requesterId) : [];
  const userIds = [...new Set([...request.decisions.map((row) => row.approverId), ...eligible])];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name?.trim() || u.email.split("@")[0]!]));
  const decidedHere = new Set(request.decisions.filter((row) => row.step === request.currentStep).map((row) => row.approverId));
  return {
    id: request.id,
    status: request.status,
    currentStep: request.currentStep,
    steps,
    requesterId: request.requesterId,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt,
    decisions: request.decisions.map((row) => ({ step: row.step, approverId: row.approverId, approverName: users.get(row.approverId) ?? "A member", decision: row.decision, comment: row.comment, createdAt: row.createdAt })),
    waitingOn: eligible.filter((id) => !decidedHere.has(id)).map((id) => users.get(id) ?? "A member"),
    canDecide: pending && eligible.includes(actor.user.id) && !decidedHere.has(actor.user.id) && request.requesterId !== actor.user.id,
  };
}

/** Is `actor` an approver (any step, past or current) of this request? */
export async function isApproverOf(actor: OpsActor, request: { id: string; steps: unknown; requesterId: string; currentStep: number }): Promise<boolean> {
  if (await prisma.approvalDecision.findFirst({ where: { requestId: request.id, approverId: actor.user.id, request: { workspaceId: actor.workspace.id } }, select: { id: true } })) return true;
  for (const step of parseSteps(request.steps)) {
    if ((await eligibleApproverIds(prisma, actor.workspace.id, step, request.requesterId)).includes(actor.user.id)) return true;
  }
  return false;
}

export type InboxItem = {
  id: string;
  subjectType: ApprovalSubjectType;
  subjectId: string;
  title: string;
  url: string;
  noun: string;
  requesterId: string;
  requesterName: string;
  amountMinor: number | null;
  currency: string | null;
  step: number;
  stepCount: number;
  createdAt: Date;
  details?: string;
};

/** Requests waiting on `actor` right now (current step, not yet decided by them). */
export async function approvalInbox(actor: OpsActor, take = 100): Promise<InboxItem[]> {
  await guard(actor);
  const pending = await prisma.approvalRequest.findMany({
    where: { workspaceId: actor.workspace.id, status: "PENDING", requesterId: { not: actor.user.id } },
    orderBy: { createdAt: "asc" },
    take: 300,
    include: { decisions: { where: { approverId: actor.user.id }, select: { step: true } } },
  });
  const memo = new Map<string, boolean>();
  const items: InboxItem[] = [];
  for (const request of pending) {
    if (request.decisions.some((row) => row.step === request.currentStep)) continue;
    const steps = parseSteps(request.steps);
    const step = steps[request.currentStep];
    if (!step) continue;
    const key = `${JSON.stringify(step)}:${request.requesterId}`;
    if (!memo.has(key)) memo.set(key, (await eligibleApproverIds(prisma, actor.workspace.id, step, request.requesterId)).includes(actor.user.id));
    if (!memo.get(key)) continue;
    const hook = approvalHook(request.subjectType);
    const access = request.subjectType === "VAULT_ACCESS" ? await prisma.vaultAccessRequest.findFirst({ where: { id: request.subjectId, workspaceId: actor.workspace.id }, select: { reason: true, durationHours: true, item: { select: { title: true } } } }) : null;
    items.push({
      details: access ? `${access.item.title} · ${access.durationHours} hours · ${access.reason ?? "No reason given"}` : undefined,
      id: request.id,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      title: request.title,
      url: hook.url(actor.workspace.slug, request.subjectId),
      noun: hook.noun,
      requesterId: request.requesterId,
      requesterName: "",
      amountMinor: request.amountMinor,
      currency: request.currency,
      step: request.currentStep,
      stepCount: steps.length,
      createdAt: request.createdAt,
    });
    if (items.length >= take) break;
  }
  const names = new Map((await prisma.user.findMany({ where: { id: { in: items.map((item) => item.requesterId) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name?.trim() || u.email.split("@")[0]!]));
  return items.map((item) => ({ ...item, requesterName: names.get(item.requesterId) ?? "A member" }));
}

/** Count for badges ("3 waiting on you"). */
export async function approvalInboxCount(actor: OpsActor): Promise<number> {
  return (await approvalInbox(actor, 99)).length;
}

/** Admin overview: every request in the workspace, newest first. */
export async function listAllApprovals(actor: OpsActor, status?: ApprovalState, take = 100) {
  if (!isAdmin(actor)) return [];
  await guard(actor, true);
  return prisma.approvalRequest.findMany({
    where: { workspaceId: actor.workspace.id, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Discussion entries use PENDING with a negative step, outside decision quorum. */
export async function commentOnApproval(actor: OpsActor, input: unknown) {
 await guard(actor);
 const value = z.object({ requestId: z.string().trim().min(1).max(64), comment: z.string().trim().min(1).max(1000) }).safeParse(input);
 if (!value.success) return validationError(value.error);
 const {requestId, comment} = value.data;
 return prisma.$transaction(async tx => {
  const rows = await tx.$queryRaw<{id:string}[]>`SELECT "id" FROM "ApprovalRequest" WHERE "id"=${requestId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
  if (!rows.length) return actionError("That request is unavailable.");
  await guard(actor, false, tx);
  const request = await tx.approvalRequest.findFirstOrThrow({where:{id:requestId,workspaceId:actor.workspace.id}});
  let allowed = isAdmin(actor) || request.requesterId === actor.user.id || !!await tx.approvalDecision.findFirst({where:{requestId,approverId:actor.user.id,request:{workspaceId:actor.workspace.id}}});
  if (!allowed) for (const step of parseSteps(request.steps)) if ((await eligibleApproverIds(tx,actor.workspace.id,step,request.requesterId)).includes(actor.user.id)) { allowed = true; break; }
  if (!allowed) return actionError("You don't have access to this request.");
  const previous = await tx.approvalDecision.aggregate({where:{requestId,request:{workspaceId:actor.workspace.id}},_min:{step:true}});
  await tx.approvalDecision.create({data:{requestId,step:Math.min(0,previous._min.step??0)-1,approverId:actor.user.id,decision:"PENDING",comment}});
  await recordAuditEvent({client:tx,workspaceId:actor.workspace.id,actorId:actor.user.id,action:"approval.commented",targetType:"ApprovalRequest",targetId:requestId});
  return {ok:true as const};
 });
}
