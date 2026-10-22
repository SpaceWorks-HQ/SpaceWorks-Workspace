import "server-only";
import { prisma } from "@/lib/db";
import { toolSchemas, monthPeriod } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  financeAccess,
  lockFinance,
  unavailable,
  validateMember,
  type FinanceActor,
} from "../access";
import { financeNote } from "../service";

export const MONTH_STEPS = [
  "Collect receipts and unpaid bills",
  "Check ledger categories and cost centres",
  "Reconcile bank and cash accounts",
  "Review payroll and statutory deposits",
  "Review spending and budget variances",
];
export async function startMonth(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.monthStart.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const prior = await tx.financeMonth.findUnique({
      where: {
        workspaceId_month: { workspaceId: actor.workspace.id, month: v.month },
      },
    });
    if (
      prior &&
      (await tx.financeMonthStep.count({
        where: { workspaceId: actor.workspace.id, monthId: prior.id },
      }))
    )
      return prior.id;
    const row =
      prior ??
      (await tx.financeMonth.create({
        data: { workspaceId: actor.workspace.id, month: v.month },
      }));
    await tx.financeMonthStep.createMany({
      data: MONTH_STEPS.map((title) => ({
        workspaceId: actor.workspace.id,
        monthId: row.id,
        title,
        ownerId: actor.user.id,
      })),
    });
    await financeNote(tx, actor, "month", row.id, "started");
    return row.id;
  });
}
export async function saveStep(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.step.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const month = await tx.financeMonth.findUnique({
      where: {
        workspaceId_month: { workspaceId: actor.workspace.id, month: v.month },
      },
    });
    if (!month) throw new FinanceError("Start the month-end checklist first.");
    if (month.signedOffAt)
      throw new FinanceError("Reopen this month before editing its checklist.");
    await validateMember(tx, actor.workspace.id, v.ownerId);
    const { id, remove, month: stepMonth, ...data } = v;
    void stepMonth;
    if (id) {
      const where = { id, workspaceId: actor.workspace.id, monthId: month.id };
      const changed = remove
        ? await tx.financeMonthStep.deleteMany({ where })
        : await tx.financeMonthStep.updateMany({ where, data });
      if (!changed.count) throw new FinanceError(unavailable);
    } else {
      if (remove) throw new FinanceError(unavailable);
      if (
        (await tx.financeMonthStep.count({
          where: { workspaceId: actor.workspace.id, monthId: month.id },
        })) >= 100
      )
        throw new FinanceError("Keep up to 100 steps in a month.");
      await tx.financeMonthStep.create({
        data: { ...data, workspaceId: actor.workspace.id, monthId: month.id },
      });
    }
    await financeNote(tx, actor, "month", month.id, "step_saved");
    return month.id;
  });
}
export async function closeMonth(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.close.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const month = await tx.financeMonth.findUnique({
      where: {
        workspaceId_month: { workspaceId: actor.workspace.id, month: v.month },
      },
    });
    if (!month) throw new FinanceError("Start the month-end checklist first.");
    if (!v.reopen && month.signedOffAt) return month.id;
    if (v.reopen) {
      const later = await tx.financeMonth.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          month: { gt: v.month },
          signedOffAt: { not: null },
        },
      });
      if (later) throw new FinanceError("Reopen later signed months first.");
      const start = dateOnly(monthPeriod(v.month).start);
      const accounts = await tx.financeAccount.findMany({
        where: {
          workspaceId: actor.workspace.id,
          reconciledUpTo: { gte: start },
        },
      });
      for (const account of accounts) {
        const previous = await tx.financeReconciliation.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            accountId: account.id,
            upTo: { lt: start },
            signedOffAt: { not: null },
          },
          orderBy: { upTo: "desc" },
        });
        await tx.financeAccount.updateMany({
          where: { workspaceId: actor.workspace.id, id: account.id },
          data: { reconciledUpTo: previous?.upTo ?? null },
        });
        await tx.financeReconciliation.updateMany({
          where: {
            workspaceId: actor.workspace.id,
            accountId: account.id,
            upTo: { gte: start },
          },
          data: { signedOffAt: null, signedOffById: null },
        });
      }
    }
    if (!v.reopen) {
      const steps = await tx.financeMonthStep.count({
        where: { workspaceId: actor.workspace.id, monthId: month.id },
      });
      const incomplete = await tx.financeMonthStep.count({
        where: {
          workspaceId: actor.workspace.id,
          monthId: month.id,
          done: false,
        },
      });
      if (!steps || incomplete)
        throw new FinanceError(
          "Complete every checklist step before signing off.",
        );
      if (!month.reviewSignedAt)
        throw new FinanceError("Sign off the spending review first.");
      const end = dateOnly(monthPeriod(v.month).end);
      const accounts = await tx.financeAccount.count({
        where: {
          workspaceId: actor.workspace.id,
          openingOn: { lte: end },
          OR: [{ reconciledUpTo: null }, { reconciledUpTo: { lt: end } }],
        },
      });
      if (accounts)
        throw new FinanceError(
          "Reconcile every account through month-end before signing off.",
        );
      const unassigned = await tx.ledgerEntry.count({
        where: {
          workspaceId: actor.workspace.id,
          voidedAt: null,
          accountId: null,
          occurredOn: { gte: dateOnly(monthPeriod(v.month).start), lte: end },
        },
      });
      if (unassigned)
        throw new FinanceError(
          "Assign every entry this month to a bank or cash account.",
        );
    }
    await tx.financeMonth.updateMany({
      where: { id: month.id, workspaceId: actor.workspace.id },
      data: {
        signedOffAt: v.reopen ? null : new Date(),
        signedOffById: v.reopen ? null : actor.user.id,
        ...(v.reopen ? { reviewSignedAt: null, reviewSignedById: null } : {}),
      },
    });
    await financeNote(
      tx,
      actor,
      "month",
      month.id,
      v.reopen ? "reopened" : "signed",
    );
    return month.id;
  });
}
export async function reviewSpending(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.review.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const month = await tx.financeMonth.upsert({
      where: {
        workspaceId_month: { workspaceId: actor.workspace.id, month: v.month },
      },
      create: { workspaceId: actor.workspace.id, month: v.month },
      update: {},
    });
    if (month.signedOffAt)
      throw new FinanceError("This month is already signed off.");
    if (
      !(await tx.financeMonthStep.count({
        where: { workspaceId: actor.workspace.id, monthId: month.id },
      }))
    )
      await tx.financeMonthStep.createMany({
        data: MONTH_STEPS.map((title) => ({
          workspaceId: actor.workspace.id,
          monthId: month.id,
          title,
          ownerId: actor.user.id,
        })),
      });
    await tx.financeMonth.updateMany({
      where: { workspaceId: actor.workspace.id, id: month.id },
      data: {
        reviewSignedAt: new Date(),
        reviewSignedById: actor.user.id,
        reviewNotes: v.notes,
      },
    });
    await financeNote(tx, actor, "spending_review", month.id, "signed");
    return month.id;
  });
}
