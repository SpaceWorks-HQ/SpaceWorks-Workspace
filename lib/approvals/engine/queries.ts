import "server-only";

import type { ApprovalSubjectType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin, type OpsActor } from "@/lib/approvals/context";
import { parseSteps, type ApprovalState, type ApprovalStep } from "@/lib/approvals/machine";
import { guard } from "@/lib/approvals/ops";
import { approvalHook } from "@/lib/approvals/registry";
import { eligibleApproverIds } from "./eligibility";

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
  const sourceGate = approvalHook(subjectType).canRead;
  if (sourceGate && !await sourceGate(prisma, actor.workspace.id, subjectId, actor.user.id)) return null;
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
    if (hook.canRead && !await hook.canRead(prisma, actor.workspace.id, request.subjectId, actor.user.id)) continue;
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
