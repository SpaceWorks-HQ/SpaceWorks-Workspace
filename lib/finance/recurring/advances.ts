import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { cancelApproval, requestApproval } from "@/lib/approvals/engine";
import { canReadStaffAdvance } from "@/lib/roles";
import {
  financeAccess,
  FinanceError,
  lockFinance,
  validateTags,
  validateMember,
  assertOpen,
  auditPayView,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import {
  advanceSchema,
  instalmentAmounts,
  nextDue,
  recoverySchema,
} from "./rules";
import { note } from "./service";

export async function readAdvance(
  actor: FinanceActor,
  id: string,
  write = false,
  tx: DbClient = prisma,
) {
  const member = await tx.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
  });
  const grant = await tx.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  const row = await tx.staffAdvance.findFirst({
    where: { workspaceId: actor.workspace.id, id },
  });
  if (
    !member ||
    !row ||
    !canReadStaffAdvance(member, grant, actor.user.id, row.userId)
  )
    throw new FinanceError("That advance is unavailable.");
  if (write) await financeAccess(actor, "PAY_MANAGE", tx);
  await auditPayView(actor, "staff_advance", id, tx);
  return row;
}
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
export async function payAdvance(
  actor: FinanceActor,
  id: string,
  paidOn: string,
  reference: string,
) {
  const { isoDateSchema } = await import("@/lib/finance/schemas");
  isoDateSchema.parse(paidOn);
  if (!reference.trim() || reference.length > 120)
    throw new FinanceError("Enter a payment reference.");
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await readAdvance(actor, id, true, tx);
    if (row.status === "PAID") return id;
    await validateMember(tx, actor.workspace.id, row.userId);
    if (row.status === "CANCELLED")
      throw new FinanceError("This advance is cancelled. Add a fresh record.");
    const approved =
      row.approvalId &&
      (await tx.approvalRequest.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: row.approvalId,
          subjectId: id,
          subjectType: "CUSTOM",
          status: "APPROVED",
        },
        include: { decisions: true },
      }));
    if (!approved)
      throw new FinanceError("Approve the advance in Requests first.");
    const reviewer = approved.decisions.find((d) => d.decision === "APPROVED");
    if (!reviewer || reviewer.approverId === row.userId)
      throw new FinanceError("Ask an independent payroll manager to approve.");
    await financeAccess(
      { ...actor, user: { id: reviewer.approverId, name: null } },
      "PAY_MANAGE",
      tx,
    );
    if (
      !(await tx.financeAttachment.count({
        where: {
          workspaceId: actor.workspace.id,
          recordType: "ADVANCE",
          recordId: id,
          file: { deletedAt: null },
        },
      }))
    )
      throw new FinanceError("Attach the advance payment proof first.");
    await validateTags(tx, actor.workspace.id, row, row.currency);
    await assertOpen(tx, actor.workspace.id, new Date(paidOn), row.accountId);
    const deposit = await tx.moneyControlRecord.create({
      data: {
        workspaceId: actor.workspace.id,
        kind: "DEPOSIT",
        title: "Staff advance",
        status: "CONFIRMED",
        ownerId: row.userId,
        accountId: row.accountId,
        fundId: row.fundId,
        amountMinor: row.amountMinor,
        currency: row.currency,
        occurredOn: new Date(paidOn),
        payroll: true,
        createdById: actor.user.id,
        recordKey: `staff-advance:${id}`,
        details: {
          direction: "GIVEN",
          counterparty: "Staff advance",
          refundable: "YES",
        },
      },
    });
    await tx.moneyControlMovement.create({
      data: {
        workspaceId: actor.workspace.id,
        recordId: deposit.id,
        accountId: row.accountId,
        amountMinor: -row.amountMinor,
        currency: row.currency,
        occurredOn: new Date(paidOn),
        reference,
        operationKey: `advance:${id}`,
      },
    });
    const amounts = instalmentAmounts(row.amountMinor, row.instalments);
    let due = row.startsOn;
    for (let i = 0; i < amounts.length; i++) {
      await tx.staffAdvanceRecovery.create({
        data: {
          workspaceId: actor.workspace.id,
          advanceId: id,
          instalment: i + 1,
          dueOn: due,
          amountMinor: amounts[i]!,
        },
      });
      due = nextDue(due, "MONTHLY", row.startsOn.getUTCDate());
    }
    await tx.staffAdvance.updateMany({
      where: { workspaceId: actor.workspace.id, id },
      data: { status: "PAID", paidOn: new Date(paidOn), depositId: deposit.id },
    });
    await note(tx, actor, id, "advance_paid");
    return id;
  });
}
export async function recoverAdvance(actor: FinanceActor, input: unknown) {
  const v = recoverySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const recovery = await tx.staffAdvanceRecovery.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.id },
    });
    if (!recovery) throw new FinanceError("Choose an advance instalment.");
    const row = await readAdvance(actor, recovery.advanceId, true, tx);
    if (!row.depositId || !row.paidOn)
      throw new FinanceError("Record the advance payment first.");
    const facts = JSON.stringify({
      recoveryId: v.id,
      amountMinor: v.amountMinor,
      paidOn: v.paidOn,
      reference: v.reference,
      payRunId: v.payRunId,
    });
    const prior = await tx.moneyControlEvent.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        action: "ADVANCE_RECOVERY",
        reference: v.operationKey,
      },
    });
    if (prior) {
      if (prior.recordId !== row.depositId || prior.notes !== facts)
        throw new FinanceError(
          "This recovery key was used for different details.",
        );
      return row.id;
    }
    if (v.amountMinor > recovery.amountMinor - recovery.recoveredMinor)
      throw new FinanceError("The recovery exceeds the instalment balance.");
    if (new Date(v.paidOn) < row.paidOn)
      throw new FinanceError("Recovery cannot precede the advance payment.");
    await assertOpen(tx, actor.workspace.id, new Date(v.paidOn), row.accountId);
    if (v.payRunId) {
      const run = await tx.financePayRun.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: v.payRunId,
          profileId: row.profileId,
          profile: { userId: row.userId },
          status: "PAID",
          currency: row.currency,
        },
      });
      if (!run || run.paidOn?.toISOString().slice(0, 10) !== v.paidOn)
        throw new FinanceError("Choose this person's paid run and paid date.");
      const used = await tx.moneyControlEvent.findMany({
        where: { workspaceId: actor.workspace.id, action: "ADVANCE_RECOVERY" },
      });
      const recovered = used.reduce((n, e) => {
        try {
          const d = JSON.parse(e.notes);
          return n + (d.payRunId === run.id ? Number(d.amountMinor) : 0);
        } catch {
          return n;
        }
      }, 0);
      if (recovered + v.amountMinor > run.advancesMinor)
        throw new FinanceError(
          "This exceeds the advance recovery entered in the pay run.",
        );
    } else
      await tx.moneyControlMovement.create({
        data: {
          workspaceId: actor.workspace.id,
          recordId: row.depositId,
          accountId: row.accountId,
          amountMinor: v.amountMinor,
          currency: row.currency,
          occurredOn: new Date(v.paidOn),
          reference: v.reference,
          operationKey: v.operationKey,
        },
      });
    await tx.staffAdvanceRecovery.updateMany({
      where: { workspaceId: actor.workspace.id, id: v.id },
      data: { recoveredMinor: { increment: v.amountMinor } },
    });
    await tx.moneyControlRecord.updateMany({
      where: { workspaceId: actor.workspace.id, id: row.depositId },
      data: { settledMinor: { increment: v.amountMinor } },
    });
    await tx.moneyControlEvent.create({
      data: {
        workspaceId: actor.workspace.id,
        recordId: row.depositId,
        actorId: actor.user.id,
        action: "ADVANCE_RECOVERY",
        reference: v.operationKey,
        notes: facts,
      },
    });
    await note(tx, actor, row.id, "advance_recovered");
    return row.id;
  });
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
