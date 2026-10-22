import "server-only";
import { prisma } from "@/lib/db";
import { requestApproval } from "@/lib/approvals/engine";
import { toolSchemas } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  assertOpen,
  financeAccess,
  lockFinance,
  unavailable,
  validateMember,
  validateTags,
  type FinanceActor,
} from "./access";
import { claimStagedFiles } from "./files";
import { financeNote } from "./service";

export async function saveDisbursement(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.disbursement.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await validateTags(tx, actor.workspace.id, v, v.currency, "EXPENSE");
    await validateMember(tx, actor.workspace.id, v.ownerId);
    const { id, fileIds, dueOn, ...rest } = v;
    const data = { ...rest, dueOn: dueOn ? dateOnly(dueOn) : null };
    if (
      id &&
      !(
        await tx.financeDisbursement.updateMany({
          where: {
            id,
            workspaceId: actor.workspace.id,
            status: "DRAFT",
            approvalId: null,
          },
          data,
        })
      ).count
    )
      throw new FinanceError(
        "Only a draft without an approval request can be edited.",
      );
    const rowId =
      id ??
      (
        await tx.financeDisbursement.create({
          data: {
            ...data,
            createdById: actor.user.id,
            workspaceId: actor.workspace.id,
          },
        })
      ).id;
    await claimStagedFiles(tx, actor, fileIds, "DISBURSEMENT", rowId);
    await financeNote(
      tx,
      actor,
      "disbursement",
      rowId,
      "saved",
      v.purpose,
      "disbursements",
    );
    return rowId;
  });
}
export async function transitionDisbursement(
  actor: FinanceActor,
  input: unknown,
) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.disbursementTransition.parse(input);
  const result = await prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await tx.financeDisbursement.findFirst({
      where: { id: v.id, workspaceId: actor.workspace.id },
    });
    if (!row) throw new FinanceError(unavailable);
    if (v.transition === "REQUEST_APPROVAL") {
      if (row.status !== "DRAFT" && row.status !== "PENDING")
        throw new FinanceError("Only an unpaid draft can request approval.");
      const approval = await requestApproval(tx, {
        workspace: actor.workspace,
        subjectType: "CUSTOM",
        subjectId: row.id,
        title: "Approve a finance disbursement",
        requesterId: actor.user.id,
        requesterName: actor.user.name,
        amountMinor: row.amountMinor,
        currency: row.currency,
      });
      await tx.financeDisbursement.updateMany({
        where: { id: row.id, workspaceId: actor.workspace.id },
        data: { approvalId: approval.requestId, status: "PENDING" },
      });
      await financeNote(
        tx,
        actor,
        "disbursement",
        row.id,
        "approval_requested",
      );
      return { id: row.id, afterCommit: approval.afterCommit };
    }
    if (v.transition === "PAY") {
      if (row.status === "PAID") return { id: row.id };
      const approval = row.approvalId
        ? await tx.approvalRequest.findFirst({
            where: {
              id: row.approvalId,
              workspaceId: actor.workspace.id,
              subjectType: "CUSTOM",
              subjectId: row.id,
              status: "APPROVED",
            },
          })
        : null;
      if (!approval)
        throw new FinanceError(
          "Approve this payout in Requests before recording payment.",
        );
      if (!v.paidOn || !v.reference)
        throw new FinanceError("Enter a paid date and payment reference.");
      await assertOpen(
        tx,
        actor.workspace.id,
        dateOnly(v.paidOn),
        row.accountId,
      );
      const attachments = await tx.financeAttachment.count({
        where: {
          workspaceId: actor.workspace.id,
          recordType: "DISBURSEMENT",
          recordId: row.id,
          file: { deletedAt: null },
        },
      });
      if (row.kind === "REIMBURSEMENT" && !attachments)
        throw new FinanceError(
          "Attach the reimbursement receipt before recording payment.",
        );
      const ledger = await tx.ledgerEntry.create({
        data: {
          workspaceId: actor.workspace.id,
          sourceType: "finance_disbursement",
          sourceId: row.id,
          kind: "EXPENSE",
          amountMinor: row.amountMinor,
          currency: row.currency,
          tdsMinor: row.tdsMinor,
          description: row.purpose,
          counterparty: row.payee,
          occurredOn: dateOnly(v.paidOn),
          costCentreId: row.costCentreId,
          fundId: row.fundId,
          accountId: row.accountId,
          categoryId: row.categoryId,
          purpose: row.purpose,
          createdById: actor.user.id,
        },
      });
      await tx.financeDisbursement.updateMany({
        where: { id: row.id, workspaceId: actor.workspace.id },
        data: {
          status: "PAID",
          paidOn: dateOnly(v.paidOn),
          reference: v.reference,
          ledgerEntryId: ledger.id,
        },
      });
    } else {
      if (row.kind !== "ADVANCE" || row.status !== "PAID")
        throw new FinanceError("Only a paid advance can be settled.");
      if (
        !v.paidOn ||
        v.settledMinor > row.amountMinor ||
        v.settledMinor < row.settledMinor
      )
        throw new FinanceError(
          "Enter a settlement date and a total between the previous settlement and advance amount.",
        );
      if (
        !(await tx.financeAttachment.count({
          where: {
            workspaceId: actor.workspace.id,
            recordType: "DISBURSEMENT",
            recordId: row.id,
            file: { deletedAt: null },
          },
        }))
      )
        throw new FinanceError("Attach settlement proof first.");
      await tx.financeDisbursement.updateMany({
        where: { id: row.id, workspaceId: actor.workspace.id },
        data: {
          settledMinor: v.settledMinor,
          settledOn: dateOnly(v.paidOn),
          notes: row.notes,
        },
      });
    }
    await financeNote(
      tx,
      actor,
      "disbursement",
      row.id,
      v.transition.toLowerCase(),
    );
    return { id: row.id };
  });
  await result.afterCommit?.();
  return result.id;
}
