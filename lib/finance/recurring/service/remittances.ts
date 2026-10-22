import "server-only";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import { prisma, type DbClient } from "@/lib/db";
import type { FinancePayRun } from "@prisma/client";
import {
  financeAccess,
  FinanceError,
  lockFinance,
  auditPayView,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { remittanceDate } from "../rules";
import { note } from "./audit";

/** Called in the PAY transaction and by beat for pre-existing paid runs. */
export async function createRemittances(tx: DbClient, run: FinancePayRun) {
  for (const [kind, amount] of [
    ["PF", run.pfMinor],
    ["ESI", run.esiMinor],
    ["PT", run.ptMinor],
    ["SALARY_TDS", run.tdsMinor],
  ] as const) {
    if (!amount) continue;
    const sourceKey = `pay:${run.id}:${kind}`,
      workspaceId = run.workspaceId;
    if (
      await tx.recurringCostDue.findUnique({
        where: { workspaceId_sourceKey: { workspaceId, sourceKey } },
      })
    )
      continue;
    const dueOn = remittanceDate(run.month, kind);
    const bill = await tx.financeBill.create({
      data: {
        workspaceId,
        vendor:
          kind === "SALARY_TDS"
            ? "Salary withholding · 192"
            : `${kind} remittance`,
        number: `${kind}-${run.month}-${run.id.slice(-8)}`,
        issuedOn: new Date(`${run.month}-01`),
        dueOn,
        amountMinor: amount,
        currency: run.currency,
        privatePayroll: true,
        categoryId: run.categoryId,
        fundId: run.fundId,
        costCentreId: run.costCentreId,
        accountId: run.accountId,
        createdById: run.createdById,
      },
    });
    await checkFundRecord(tx, workspaceId, run.createdById, "bill", bill.id);
    await tx.recurringCostDue.create({
      data: {
        workspaceId,
        sourceKey,
        kind,
        dueOn,
        billId: bill.id,
        payRunId: run.id,
      },
    });
  }
}
export async function changeRemittanceDue(
  actor: FinanceActor,
  billId: string,
  date: string,
) {
  const { isoDateSchema } = await import("@/lib/finance/schemas");
  isoDateSchema.parse(date);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "PAY_MANAGE", tx);
    const row = await tx.recurringCostDue.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        billId,
        payRunId: { not: null },
      },
      include: { bill: true },
    });
    if (!row || row.bill.paidMinor || new Date(date) < row.bill.issuedOn)
      throw new FinanceError(
        "Choose an unpaid remittance and a date after its bill date.",
      );
    await tx.financeBill.updateMany({
      where: { workspaceId: actor.workspace.id, id: billId },
      data: { dueOn: new Date(date) },
    });
    await tx.recurringCostDue.updateMany({
      where: { workspaceId: actor.workspace.id, id: row.id },
      data: { dueOn: new Date(date) },
    });
    await auditPayView(actor, "remittance", billId, tx);
    await note(tx, actor, billId, "due_changed");
    return billId;
  });
}
