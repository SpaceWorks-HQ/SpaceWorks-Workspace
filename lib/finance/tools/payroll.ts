import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { toolSchemas, payTotals } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  assertOpen,
  auditPayView,
  financeAccess,
  lockFinance,
  unavailable,
  validateMember,
  validateTags,
  type FinanceActor,
} from "./access";
import { financeNote } from "./service";
import { recordAuditEvent } from "@/lib/audit";

export async function grantPayroll(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "OWNER");
  const v = toolSchemas.grant.parse(input);
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "OWNER", tx);
    await validateMember(tx, actor.workspace.id, v.userId);
    if (v.access === "NONE")
      await tx.financePayrollGrant.deleteMany({
        where: { workspaceId: actor.workspace.id, userId: v.userId },
      });
    else
      await tx.financePayrollGrant.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: actor.workspace.id,
            userId: v.userId,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          userId: v.userId,
          manage: v.access === "MANAGE",
          grantedById: actor.user.id,
        },
        update: { manage: v.access === "MANAGE", grantedById: actor.user.id },
      });
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "finance.payroll_access_changed",
      targetType: "user",
      targetId: v.userId,
      metadata: { access: v.access },
      client: tx,
    });
    return v.userId;
  });
}
export async function savePayProfile(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "PAY_MANAGE");
  const v = toolSchemas.payProfile.parse(input);
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "PAY_MANAGE", tx);
    await validateMember(tx, actor.workspace.id, v.userId);
    await validateTags(tx, actor.workspace.id, v, v.currency);
    const { id, pan, bankLast4, ifsc, clearPan, clearBank, archived, ...rest } =
      v;
    const data = {
      ...rest,
      archivedAt: archived ? new Date() : null,
      ...(pan
        ? { panEnc: encryptSecret("finance-pay-pan", pan) }
        : clearPan
          ? { panEnc: null }
          : {}),
      ...(bankLast4 || ifsc
        ? {
            bankEnc: encryptSecret(
              "finance-pay-bank",
              JSON.stringify({ last4: bankLast4, ifsc }),
            ),
          }
        : clearBank
          ? { bankEnc: null }
          : {}),
    };
    if (id) {
      const row = await tx.financePayProfile.findFirst({
        where: { id, workspaceId: actor.workspace.id },
      });
      if (!row) throw new FinanceError(unavailable);
      if (
        row.currency !== v.currency &&
        (await tx.financePayRun.count({
          where: { workspaceId: actor.workspace.id, profileId: id },
        }))
      )
        throw new FinanceError(
          "This person has pay runs. Keep the profile's currency.",
        );
      await tx.financePayProfile.updateMany({
        where: { id, workspaceId: actor.workspace.id },
        data,
      });
    }
    const rowId =
      id ??
      (
        await tx.financePayProfile.create({
          data: { ...data, workspaceId: actor.workspace.id },
        })
      ).id;
    await financeNote(tx, actor, "pay_profile", rowId, "saved");
    return rowId;
  });
}
export async function revealPayDetails(actor: FinanceActor, profileId: string) {
  await financeAccess(actor, "PAY_VIEW");
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "PAY_VIEW", tx);
    const profile = await tx.financePayProfile.findFirst({
      where: { workspaceId: actor.workspace.id, id: profileId },
    });
    if (!profile) throw new FinanceError(unavailable);
    await auditPayView(actor, "pay_profile_details", profile.id, tx);
    return {
      pan: profile.panEnc
        ? decryptSecret("finance-pay-pan", profile.panEnc)
        : "",
      bank: profile.bankEnc
        ? (JSON.parse(decryptSecret("finance-pay-bank", profile.bankEnc)) as {
            last4: string;
            ifsc: string;
          })
        : null,
    };
  });
}
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
