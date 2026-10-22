import "server-only";

import { z } from "zod";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { displayName, isAdmin, type OpsActor } from "@/lib/approvals/context";
import {
  APPROVAL_DECISIONS,
  decisionBlocker,
  parseSteps,
  requiredApprovals,
  transition,
  type ApprovalState,
} from "@/lib/approvals/machine";
import { guard } from "@/lib/approvals/ops";
import { approvalHook } from "@/lib/approvals/registry";
import type { ApprovalOutcome } from "@/lib/approvals/types";
import { eligibleApproverIds } from "./eligibility";
import { notifyDecided, notifyRequested } from "./notifications";

type After = () => Promise<void>;

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
    const sourceGate = approvalHook(request.subjectType).canRead;
    if (sourceGate && !await sourceGate(tx, actor.workspace.id, request.subjectId, actor.user.id)) return { ok: false, error: "That request is unavailable." };
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
  const sourceGate = approvalHook(request.subjectType).canRead;
  if (sourceGate && !await sourceGate(tx, actor.workspace.id, request.subjectId, actor.user.id)) return actionError("That request is unavailable.");
  let allowed = isAdmin(actor) || request.requesterId === actor.user.id || !!await tx.approvalDecision.findFirst({where:{requestId,approverId:actor.user.id,request:{workspaceId:actor.workspace.id}}});
  if (!allowed) for (const step of parseSteps(request.steps)) if ((await eligibleApproverIds(tx,actor.workspace.id,step,request.requesterId)).includes(actor.user.id)) { allowed = true; break; }
  if (!allowed) return actionError("You don't have access to this request.");
  const previous = await tx.approvalDecision.aggregate({where:{requestId,request:{workspaceId:actor.workspace.id}},_min:{step:true}});
  await tx.approvalDecision.create({data:{requestId,step:Math.min(0,previous._min.step??0)-1,approverId:actor.user.id,decision:"PENDING",comment}});
  await recordAuditEvent({client:tx,workspaceId:actor.workspace.id,actorId:actor.user.id,action:"approval.commented",targetType:"ApprovalRequest",targetId:requestId});
  return {ok:true as const};
 });
}
