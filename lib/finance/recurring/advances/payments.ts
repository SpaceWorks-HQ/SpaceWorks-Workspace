import "server-only";
import { prisma } from "@/lib/db";
import {
  assertOpen,
  financeAccess,
  FinanceError,
  lockFinance,
  validateMember,
  validateTags,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { instalmentAmounts, nextDue } from "../rules";
import { note } from "../service";

import { readAdvance } from "./access";

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
