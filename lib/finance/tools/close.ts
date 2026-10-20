import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { toolSchemas, monthPeriod } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  financeAccess,
  lockFinance,
  unavailable,
  validateMember,
  type FinanceActor,
} from "./access";
import { financeNote } from "./service";

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
export async function addAccount(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.account.parse(input);
  return prisma.$transaction(async (tx) => {
    const row = await tx.financeAccount.create({
      data: {
        ...v,
        openingOn: dateOnly(v.openingOn),
        workspaceId: actor.workspace.id,
      },
    });
    await financeNote(tx, actor, "account", row.id, "created");
    return row.id;
  });
}

export async function accountBalance(
  client: DbClient,
  workspaceId: string,
  accountId: string,
  upTo: Date,
) {
  const account = await client.financeAccount.findFirst({
    where: { id: accountId, workspaceId },
  });
  if (!account || upTo < account.openingOn)
    throw new FinanceError(
      "Choose an account and a date on or after its opening date.",
    );
  const totals = await client.ledgerEntry.groupBy({
    by: ["kind"],
    where: {
      workspaceId,
      accountId,
      currency: account.currency,
      voidedAt: null,
      occurredOn: { gte: account.openingOn, lte: upTo },
    },
    _sum: { amountMinor: true },
  });
  const movements = await client.moneyControlMovement.aggregate({where:{workspaceId,accountId,currency:account.currency,occurredOn:{gte:account.openingOn,lte:upTo}},_sum:{amountMinor:true}});
  const balanceMinor =
    account.openingMinor + (movements._sum.amountMinor ?? 0) +
    totals.reduce(
      (n, r) => n + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amountMinor ?? 0),
      0,
    );
  return { account, balanceMinor };
}
export async function markReconciled(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.mark.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await tx.ledgerEntry.findFirst({
      where: { id: v.entryId, workspaceId: actor.workspace.id, voidedAt: null },
    });
    if (!row?.accountId)
      throw new FinanceError("Assign this entry to an account first.");
    if (row.privatePayroll) await financeAccess(actor, "PAY_MANAGE", tx);
    const account = await tx.financeAccount.findFirstOrThrow({
      where: { id: row.accountId, workspaceId: actor.workspace.id },
    });
    if (account.reconciledUpTo && row.occurredOn <= account.reconciledUpTo)
      throw new FinanceError(
        "This entry is already covered by a signed reconciliation.",
      );
    await tx.ledgerEntry.updateMany({
      where: { id: row.id, workspaceId: actor.workspace.id },
      data: { reconciledAt: v.reconciled ? new Date() : null },
    });
    await financeNote(tx, actor, "entry", row.id, "reconciliation_marked");
    return row.id;
  });
}
export async function reconcileAccount(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.reconcile.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const upTo = dateOnly(v.upTo);
    const { account, balanceMinor } = await accountBalance(
      tx,
      actor.workspace.id,
      v.accountId,
      upTo,
    );
    if (v.signOff) {
      if (account.reconciledUpTo && upTo <= account.reconciledUpTo)
        throw new FinanceError(
          "Choose a date after the last signed reconciliation.",
        );
      if (balanceMinor !== v.statementMinor)
        throw new FinanceError(
          "The statement and ledger differ. Correct or explain the entries before signing off.",
        );
      const remaining = await tx.ledgerEntry.count({
        where: {
          workspaceId: actor.workspace.id,
          accountId: account.id,
          voidedAt: null,
          reconciledAt: null,
          occurredOn: { gte: account.openingOn, lte: upTo },
        },
      });
      const uncheckedMovements = await tx.moneyControlMovement.count({where:{workspaceId:actor.workspace.id,accountId:account.id,reconciledAt:null,occurredOn:{gte:account.openingOn,lte:upTo}}});
      if (uncheckedMovements) throw new FinanceError("Mark transfers and deposit movements reconciled in Cash controls first.");
      if (remaining)
        throw new FinanceError(
          "Mark every entry through this date reconciled before signing off.",
        );
      await tx.financeAccount.updateMany({
        where: { id: account.id, workspaceId: actor.workspace.id },
        data: { reconciledUpTo: upTo },
      });
    }
    const row = await tx.financeReconciliation.create({
      data: {
        workspaceId: actor.workspace.id,
        accountId: account.id,
        upTo,
        statementMinor: v.statementMinor,
        ledgerMinor: BigInt(balanceMinor),
        notes: v.notes,
        signedOffAt: v.signOff ? new Date() : null,
        signedOffById: v.signOff ? actor.user.id : null,
      },
    });
    await financeNote(
      tx,
      actor,
      "reconciliation",
      row.id,
      v.signOff ? "signed" : "compared",
    );
    return row.id;
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
