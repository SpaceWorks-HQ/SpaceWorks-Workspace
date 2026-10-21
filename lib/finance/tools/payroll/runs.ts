import "server-only";
import { createRemittances } from "@/lib/finance/recurring/service";
import { prisma } from "@/lib/db";
import {
  toolSchemas,
  payTotals,
} from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  assertOpen,
  financeAccess,
  lockFinance,
  unavailable,
  validateTags,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { financeNote } from "@/lib/finance/tools/service";

export async function savePayRun(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "PAY_MANAGE");
  const v = toolSchemas.payRun.parse(input);
  const totals = payTotals(v);
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "PAY_MANAGE", tx);
    await lockFinance(tx, actor.workspace.id);
    const profile = await tx.financePayProfile.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: v.profileId,
        archivedAt: null,
      },
    });
    if (!profile) throw new FinanceError("Choose an active pay profile.");
    await validateTags(tx, actor.workspace.id, v, profile.currency, "EXPENSE");
    const { id, purpose, ...rest } = v;
    void purpose;
    const data = {
      ...rest,
      netMinor: totals.netMinor,
      currency: profile.currency,
    };
    if (
      id &&
      !(
        await tx.financePayRun.updateMany({
          where: { id, workspaceId: actor.workspace.id, status: "DRAFT" },
          data,
        })
      ).count
    )
      throw new FinanceError("Only draft pay runs can be edited.");
    const rowId =
      id ??
      (
        await tx.financePayRun.create({
          data: {
            ...data,
            createdById: actor.user.id,
            workspaceId: actor.workspace.id,
          },
        })
      ).id;
    await financeNote(tx, actor, "pay_run", rowId, "saved");
    return rowId;
  });
}
export async function transitionPayRun(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "PAY_MANAGE");
  const v = toolSchemas.payTransition.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "PAY_MANAGE", tx);
    const row = await tx.financePayRun.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.runId },
    });
    if (!row) throw new FinanceError(unavailable);
    if (v.transition === "REOPEN") {
      if (row.status !== "APPROVED")
        throw new FinanceError("Only an approved, unpaid run can be reopened.");
      await tx.financePayRun.updateMany({
        where: { workspaceId: actor.workspace.id, id: row.id },
        data: { status: "DRAFT", approvedAt: null, approvedById: null },
      });
    } else if (v.transition === "APPROVE") {
      if (row.status === "APPROVED") return row.id;
      if (row.status !== "DRAFT")
        throw new FinanceError("Only a draft run can be approved.");
      if (row.createdById === actor.user.id)
        throw new FinanceError(
          "Ask another payroll manager to approve this run.",
        );
      payTotals(row);
      await tx.financePayRun.updateMany({
        where: { workspaceId: actor.workspace.id, id: row.id },
        data: {
          status: "APPROVED",
          approvedById: actor.user.id,
          approvedAt: new Date(),
        },
      });
    } else if (v.transition === "PAY") {
      if (row.status === "PAID") return row.id;
      if (row.status !== "APPROVED")
        throw new FinanceError("Approve this run before recording payment.");
      if (!v.paidOn || !v.reference)
        throw new FinanceError("Enter the paid date and payment reference.");
      await assertOpen(
        tx,
        actor.workspace.id,
        dateOnly(v.paidOn),
        row.accountId,
      );
      await tx.financePayRun.updateMany({
        where: { workspaceId: actor.workspace.id, id: row.id },
        data: {
          status: "PAID",
          paidOn: dateOnly(v.paidOn),
          reference: v.reference,
        },
      });
      await createRemittances(tx, {...row,status:"PAID",paidOn:dateOnly(v.paidOn)});
    } else {
      if (row.status !== "PAID" || !row.paidOn)
        throw new FinanceError(
          "Record payment before posting this run to the ledger.",
        );
      if (row.ledgerEntryId) return row.id;
      await assertOpen(tx, actor.workspace.id, row.paidOn, row.accountId);
      // Cash basis: post the amount actually paid. Statutory dues remain in the pay register.
      const ledger = await tx.ledgerEntry.create({
        data: {
          workspaceId: actor.workspace.id,
          sourceType: "finance_payroll",
          sourceId: row.id,
          privatePayroll: true,
          kind: "EXPENSE",
          amountMinor: row.netMinor,
          currency: row.currency,
          categoryId: row.categoryId,
          costCentreId: row.costCentreId,
          fundId: row.fundId,
          accountId: row.accountId,
          description: "Payroll payment",
          occurredOn: row.paidOn,
          createdById: actor.user.id,
        },
      });
      await tx.financePayRun.updateMany({
        where: { workspaceId: actor.workspace.id, id: row.id },
        data: { ledgerEntryId: ledger.id },
      });
    }
    await financeNote(tx, actor, "pay_run", row.id, v.transition.toLowerCase());
    return row.id;
  });
}

/** Correct only coding/account details after payment; approved pay amounts stay immutable. */
export async function savePayBookkeeping(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "PAY_MANAGE");
  const v = toolSchemas.payBookkeeping.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "PAY_MANAGE", tx);
    const row = await tx.financePayRun.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.runId },
    });
    if (!row || row.status !== "PAID" || !row.paidOn)
      throw new FinanceError("Choose a paid payroll run.");
    await assertOpen(tx, actor.workspace.id, row.paidOn, row.accountId);
    await assertOpen(tx, actor.workspace.id, row.paidOn, v.accountId);
    await validateTags(tx, actor.workspace.id, v, row.currency, "EXPENSE");
    const { runId, purpose, ...tags } = v;
    if (row.ledgerEntryId) {
      const changed = await tx.ledgerEntry.updateMany({
        where: {
          workspaceId: actor.workspace.id,
          id: row.ledgerEntryId,
          sourceType: "finance_payroll",
          sourceId: row.id,
          privatePayroll: true,
          voidedAt: null,
        },
        data: { ...tags, purpose, reconciledAt: null },
      });
      if (!changed.count) throw new FinanceError(unavailable);
    }
    await tx.financePayRun.updateMany({
      where: { workspaceId: actor.workspace.id, id: runId },
      data: tags,
    });
    await financeNote(tx, actor, "pay_run", row.id, "bookkeeping_updated");
    return row.id;
  });
}
