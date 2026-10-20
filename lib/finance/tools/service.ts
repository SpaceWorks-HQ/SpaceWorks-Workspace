import "server-only";
import { recurringPaymentGate, recurringPaymentAccounting } from "@/lib/finance/recurring/payments";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
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
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";

export async function financeNote(
  tx: DbClient,
  actor: FinanceActor,
  type: string,
  id: string,
  verb: string,
  title?: string,
  section?: string,
) {
  await checkFundRecord(tx, actor.workspace.id, actor.user.id, type, id);
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `finance.${type}_${verb}`,
    targetType: type,
    targetId: id,
    client: tx,
  });
  await recordActivity(
    {
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      entityType: `finance_${type}`,
      entityId: id,
      verb,
      summary: "A finance record changed.",
      visibility: "PRIVATE",
    },
    tx,
  );
  if (title && section)
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: `finance_${type}`,
        entityId: id,
        title,
        url: `/w/${actor.workspace.slug}/finance/${section}`,
        ownerId: actor.user.id,
        visibility: "PRIVATE",
      },
      tx,
    );
}

export async function saveFund(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.fund.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const { id, archived, ...data } = v;
    if (id) {
      const existing = await tx.financeFund.findFirst({
        where: { id, workspaceId: actor.workspace.id },
      });
      if (!existing) throw new FinanceError(unavailable);
      if (
        existing.currency !== data.currency &&
        (await tx.ledgerEntry.count({
          where: { workspaceId: actor.workspace.id, fundId: id },
        }))
      )
        throw new FinanceError("This fund has entries. Keep its currency.");
      await tx.financeFund.updateMany({
        where: { id, workspaceId: actor.workspace.id },
        data: { ...data, archivedAt: archived ? new Date() : null },
      });
    }
    const rowId =
      id ??
      (
        await tx.financeFund.create({
          data: { ...data, workspaceId: actor.workspace.id },
        })
      ).id;
    await financeNote(tx, actor, "fund", rowId, "saved", v.name, "funds");
    return rowId;
  });
}

export async function saveCentre(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.centre.parse(input);
  return prisma.$transaction(async (tx) => {
    const { id, archived, ...data } = v;
    if (v.projectId) {
      const hidden = await hiddenTeamIds(
        actor.workspace.id,
        { userId: actor.user.id, role: actor.membership.role },
        tx,
      );
      if (
        !(await tx.project.findFirst({
          where: {
            id: v.projectId,
            workspaceId: actor.workspace.id,
            status: { not: "ARCHIVED" },
            ...teamScopeFilter(hidden),
          },
        }))
      )
        throw new FinanceError(
          "Choose a project you can open in this workspace.",
        );
    }
    if (
      id &&
      !(
        await tx.financeCostCentre.updateMany({
          where: { id, workspaceId: actor.workspace.id },
          data: { ...data, archivedAt: archived ? new Date() : null },
        })
      ).count
    )
      throw new FinanceError(unavailable);
    const rowId =
      id ??
      (
        await tx.financeCostCentre.create({
          data: { ...data, workspaceId: actor.workspace.id },
        })
      ).id;
    await financeNote(tx, actor, "centre", rowId, "saved", v.name, "funds");
    return rowId;
  });
}

export async function saveBudget(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.budget.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await validateTags(tx, actor.workspace.id, v, v.currency, "EXPENSE");
    const { id, categoryId, periodStart, periodEnd, ...rest } = v;
    if (
      (categoryId || v.costCentreId) &&
      (await tx.budget.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: id ? { not: id } : undefined,
          currency: v.currency,
          costCentreId: v.costCentreId,
          categories: { equals: categoryId ? [categoryId] : [] },
          periodStart: dateOnly(periodStart),
          periodEnd: dateOnly(periodEnd),
        },
      }))
    )
      throw new FinanceError(
        "A budget line already covers this category, cost centre and period. Edit that line.",
      );
    const data = {
      ...rest,
      periodStart: dateOnly(periodStart),
      periodEnd: dateOnly(periodEnd),
      categories: categoryId ? [categoryId] : [],
      thresholdsPct: [80, 100],
    };
    if (
      id &&
      !(
        await tx.budget.updateMany({
          where: { id, workspaceId: actor.workspace.id },
          data,
        })
      ).count
    )
      throw new FinanceError(unavailable);
    const rowId =
      id ??
      (
        await tx.budget.create({
          data: {
            ...data,
            workspaceId: actor.workspace.id,
            createdById: actor.user.id,
          },
        })
      ).id;
    await financeNote(tx, actor, "budget", rowId, "saved", v.name, "budgets");
    return rowId;
  });
}

export async function addEntry(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.entry.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await assertOpen(
      tx,
      actor.workspace.id,
      dateOnly(v.occurredOn),
      v.accountId,
    );
    await validateTags(tx, actor.workspace.id, v, v.currency, v.kind);
    if (v.accountId) {
      const account = await tx.financeAccount.findFirstOrThrow({
        where: { id: v.accountId, workspaceId: actor.workspace.id },
      });
      if (dateOnly(v.occurredOn) < account.openingOn)
        throw new FinanceError(
          "Use a date on or after the account opening date.",
        );
    }
    const { fileIds, occurredOn, ...data } = v;
    const row = await tx.ledgerEntry.create({
      data: {
        ...data,
        occurredOn: dateOnly(occurredOn),
        workspaceId: actor.workspace.id,
        createdById: actor.user.id,
      },
    });
    const extractionUsed = await claimStagedFiles(
      tx,
      actor,
      fileIds,
      "LEDGER",
      row.id,
    );
    if (extractionUsed)
      await tx.ledgerEntry.updateMany({
        where: { workspaceId: actor.workspace.id, id: row.id },
        data: { extractionUsed: true },
      });
    await financeNote(
      tx,
      actor,
      "entry",
      row.id,
      "created",
      row.description,
      "spending",
    );
    return row.id;
  });
}

export async function saveEntryTags(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.tags.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await tx.ledgerEntry.findFirst({
      where: {
        id: v.entryId,
        workspaceId: actor.workspace.id,
        voidedAt: null,
        privatePayroll: false,
      },
    });
    if (!row) throw new FinanceError(unavailable);
    await assertOpen(tx, actor.workspace.id, row.occurredOn, row.accountId);
    await assertOpen(tx, actor.workspace.id, row.occurredOn, v.accountId);
    await validateTags(tx, actor.workspace.id, v, row.currency, row.kind);
    if (v.accountId) {
      const a = await tx.financeAccount.findFirstOrThrow({
        where: { id: v.accountId, workspaceId: actor.workspace.id },
      });
      if (row.occurredOn < a.openingOn)
        throw new FinanceError(
          "The entry date is before this account's opening date.",
        );
    }
    const { entryId, ...data } = v;
    await tx.ledgerEntry.updateMany({
      where: { id: entryId, workspaceId: actor.workspace.id },
      data: { ...data, reconciledAt: null },
    });
    await financeNote(tx, actor, "entry", row.id, "tagged");
    return row.id;
  });
}

export async function saveBill(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.bill.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await validateTags(tx, actor.workspace.id, v, v.currency, "EXPENSE");
    await validateMember(tx, actor.workspace.id, v.ownerId);
    const { id, fileIds, issuedOn, dueOn, ...rest } = v;
    const data = {
      ...rest,
      issuedOn: dateOnly(issuedOn),
      dueOn: dateOnly(dueOn),
    };
    if (id) {
      const row = await tx.financeBill.findFirst({
        where: { id, workspaceId: actor.workspace.id },
      });
      if (!row) throw new FinanceError(unavailable);
      if (row.privatePayroll) throw new FinanceError("Edit remittances in Payroll dues.");
      if (await tx.recurringCostDue.findFirst({where:{workspaceId:actor.workspace.id,billId:row.id}})) throw new FinanceError("Confirm recurring bill amounts in Upcoming dues.");
      if (row.paidMinor > 0)
        throw new FinanceError(
          "This bill has payments. Keep its recorded details.",
        );
      await tx.financeBill.updateMany({
        where: { id, workspaceId: actor.workspace.id },
        data,
      });
    }
    const rowId =
      id ??
      (
        await tx.financeBill.create({
          data: {
            ...data,
            workspaceId: actor.workspace.id,
            createdById: actor.user.id,
          },
        })
      ).id;
    await claimStagedFiles(tx, actor, fileIds, "BILL", rowId);
    await financeNote(
      tx,
      actor,
      "bill",
      rowId,
      "saved",
      `${v.vendor} ${v.number}`,
      "bills",
    );
    return rowId;
  });
}

export async function payBill(actor: FinanceActor, input: unknown) {
  const v = toolSchemas.billPayment.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const existing = await tx.financeBillPayment.findUnique({
      where: {
        workspaceId_paymentKey: {
          workspaceId: actor.workspace.id,
          paymentKey: v.paymentKey,
        },
      },
    });
    const paymentBill = await tx.financeBill.findFirst({where:{workspaceId:actor.workspace.id,id:v.billId}});
    if(!paymentBill) throw new FinanceError(unavailable);
    await recurringPaymentGate(tx,actor,paymentBill);
    if (existing) {
      if (
        existing.billId !== v.billId ||
        existing.amountMinor !== v.amountMinor ||
        existing.reference !== v.reference ||
        existing.paidOn.getTime() !== dateOnly(v.paidOn).getTime() ||
        existing.posted !== v.post
      )
        throw new FinanceError(
          "That payment reference was already used for different details. Refresh and try again.",
        );
      return existing.id;
    }
    const bill = await tx.financeBill.findFirst({
      where: { id: v.billId, workspaceId: actor.workspace.id },
    });
    if (!bill) throw new FinanceError(unavailable);
    if (v.amountMinor > bill.amountMinor - bill.paidMinor)
      throw new FinanceError("The payment exceeds the bill's unpaid balance.");
    if (dateOnly(v.paidOn) < bill.issuedOn)
      throw new FinanceError("Payment cannot be before the bill date.");
    await assertOpen(
      tx,
      actor.workspace.id,
      dateOnly(v.paidOn),
      bill.accountId,
    );
    const payment = await tx.financeBillPayment.create({
      data: {
        workspaceId: actor.workspace.id,
        billId: bill.id,
        paymentKey: v.paymentKey,
        amountMinor: v.amountMinor,
        paidOn: dateOnly(v.paidOn),
        reference: v.reference,
        posted: v.post,
        createdById: actor.user.id,
      },
    });
    await tx.financeBill.updateMany({
      where: { id: bill.id, workspaceId: actor.workspace.id },
      data: { paidMinor: { increment: v.amountMinor } },
    });
    const expense = await recurringPaymentAccounting(tx,actor,bill,v.amountMinor,dateOnly(v.paidOn),v.reference,payment.id,v.post);
    if (v.post && expense > 0)
      await tx.ledgerEntry.create({
        data: {
          workspaceId: actor.workspace.id,
          privatePayroll: bill.privatePayroll,
          kind: "EXPENSE",
          amountMinor: expense,
          currency: bill.currency,
          description: `Bill ${bill.number}`,
          counterparty: bill.vendor,
          occurredOn: dateOnly(v.paidOn),
          categoryId: bill.categoryId,
          fundId: bill.fundId,
          costCentreId: bill.costCentreId,
          accountId: bill.accountId,
          purpose: bill.purpose,
          invoiceNumber: bill.number,
          gstin: bill.gstin,
          sourceType: "finance_bill_payment",
          sourceId: payment.id,
          createdById: actor.user.id,
        },
      });
    await financeNote(tx, actor, "bill", bill.id, "payment_recorded");
    return payment.id;
  });
}

/** Category lines count ledger actuals automatically; legacy budgets retain explicit entry links. */
export function budgetActualWhere(budget: {
  id: string;
  workspaceId: string;
  currency: string;
  categories: string[];
  costCentreId: string | null;
  periodStart: Date;
  periodEnd: Date;
}) {
  return {
    workspaceId: budget.workspaceId,
    currency: budget.currency,
    kind: "EXPENSE" as const,
    voidedAt: null,
    occurredOn: { gte: budget.periodStart, lte: budget.periodEnd },
    ...(budget.categories.length || budget.costCentreId
      ? {
          ...(budget.categories.length
            ? { categoryId: { in: budget.categories } }
            : {}),
          ...(budget.costCentreId ? { costCentreId: budget.costCentreId } : {}),
        }
      : { budgetId: budget.id }),
  };
}
export async function budgetActual(
  tx: DbClient,
  budget: Parameters<typeof budgetActualWhere>[0],
) {
  return (
    (
      await tx.ledgerEntry.aggregate({
        where: budgetActualWhere(budget),
        _sum: { amountMinor: true },
      })
    )._sum.amountMinor ?? 0
  );
}
