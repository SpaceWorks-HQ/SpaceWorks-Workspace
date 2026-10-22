import "server-only";
import { cancelApproval, requestApproval } from "@/lib/approvals/engine";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  lockFinance,
  validateMember,
  validateTags,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { advanceSchema } from "../rules";
import { note } from "../service";

import { readAdvance } from "./access";

export async function saveAdvance(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "PAY_MANAGE");
  const v = advanceSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "PAY_MANAGE", tx);
    const existing = await tx.staffAdvance.findFirst({
      where: { workspaceId: actor.workspace.id, requestKey: v.requestKey },
    });
    if (existing) return existing.id;
    const profile = await tx.financePayProfile.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: v.profileId,
        archivedAt: null,
      },
    });
    if (!profile?.userId)
      throw new FinanceError(
        "Link this pay profile to an active team member first.",
      );
    await validateMember(tx, actor.workspace.id, profile.userId);
    await validateTags(tx, actor.workspace.id, v, profile.currency);
    if (v.amountMinor < v.instalments)
      throw new FinanceError(
        "Use fewer instalments than minor units in the advance.",
      );
    const { startsOn, ...rest } = v;
    const row = await tx.staffAdvance.create({
      data: {
        ...rest,
        startsOn: new Date(startsOn),
        workspaceId: actor.workspace.id,
        userId: profile.userId,
        currency: profile.currency,
        createdById: actor.user.id,
      },
    });
    await note(tx, actor, row.id, "advance_saved");
    return row.id;
  });
}
export async function requestAdvanceApproval(
  actor: FinanceActor,
  id: string,
  approverId: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await readAdvance(actor, id, true, tx);
    if (["PAID", "CANCELLED"].includes(row.status))
      throw new FinanceError("Choose an unpaid active advance.");
    if (approverId === row.userId || approverId === actor.user.id)
      throw new FinanceError(
        "Ask another payroll manager to approve the advance.",
      );
    await financeAccess(
      { ...actor, user: { id: approverId, name: null } },
      "PAY_MANAGE",
      tx,
    );
    // Generic inbox facts keep private pay amounts/reasons outside the approvals list.
    const approval = await requestApproval(tx, {
      workspace: actor.workspace,
      subjectType: "CUSTOM",
      subjectId: row.id,
      title: "Review a private staff advance in Payroll",
      requesterId: actor.user.id,
      requesterName: actor.user.name,
      steps: [{ approverType: "USER", ref: approverId, minApprovals: 1 }],
    });
    await tx.staffAdvance.updateMany({
      where: { workspaceId: actor.workspace.id, id },
      data: { approvalId: approval.requestId, status: "PENDING" },
    });
    await note(tx, actor, id, "advance_requested");
    return { id, afterCommit: approval.afterCommit };
  });
  await result.afterCommit();
  return result.id;
}
export async function cancelAdvance(actor: FinanceActor, id: string) {
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await readAdvance(actor, id, true, tx);
    if (row.paidOn)
      throw new FinanceError(
        "A paid advance cannot be cancelled. Record its repayments instead.",
      );
    await cancelApproval(tx, {
      workspaceId: actor.workspace.id,
      subjectType: "CUSTOM",
      subjectId: id,
      actorId: actor.user.id,
    });
    await tx.staffAdvance.updateMany({
      where: { workspaceId: actor.workspace.id, id },
      data: { status: "CANCELLED" },
    });
    await note(tx, actor, id, "advance_cancelled");
    return id;
  });
}
