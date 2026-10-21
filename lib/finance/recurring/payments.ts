import "server-only";
import type { FinanceBill } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { fiscalYear, fiscalQuarter } from "@/lib/moneyControls/rules";
/** A recurring bill retains the ordinary bill-payment idempotency and finance lock. */
export async function recurringPaymentGate(
  tx: DbClient,
  actor: FinanceActor,
  bill: FinanceBill,
) {
  await financeAccess(actor, bill.privatePayroll ? "PAY_MANAGE" : "MANAGE", tx);
  if (bill.needsActual)
    throw new FinanceError(
      "Confirm this bill's actual amount and tax components before paying.",
    );
  const due = await tx.recurringCostDue.findFirst({
    where: { workspaceId: actor.workspace.id, billId: bill.id },
    include: { schedule: true },
  });
  if (due?.kind === "EMI" && !due.splitConfirmed)
    throw new FinanceError(
      "Enter the principal and interest split before paying this EMI.",
    );
  if (
    bill.privatePayroll &&
    !(await tx.financeAttachment.count({
      where: {
        workspaceId: actor.workspace.id,
        recordType: "BILL",
        recordId: bill.id,
        file: { deletedAt: null },
      },
    }))
  )
    throw new FinanceError(
      "Upload the remittance challan before recording payment.",
    );
  return due;
}
/** Return the expense part; principal uses existing cash-only movements. */
export async function recurringPaymentAccounting(
  tx: DbClient,
  actor: FinanceActor,
  bill: FinanceBill,
  amount: number,
  paidOn: Date,
  reference: string,
  paymentId: string,
  post: boolean,
) {
  const due = await recurringPaymentGate(tx, actor, bill);
  let expense = amount;
  if (due?.kind === "EMI" && due.schedule) {
    const principal =
      Math.round(
        ((bill.paidMinor + amount) * due.principalMinor) / bill.amountMinor,
      ) - Math.round((bill.paidMinor * due.principalMinor) / bill.amountMinor);
    expense -= principal;
    if (post && principal) {
      if (!bill.accountId)
        throw new FinanceError(
          "Choose an account on the EMI schedule before generating bills.",
        );
      const key = `emi:${due.schedule.id}`;
      const record = await tx.moneyControlRecord.upsert({
        where: {
          workspaceId_kind_recordKey: {
            workspaceId: actor.workspace.id,
            kind: "DEPOSIT",
            recordKey: key,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          kind: "DEPOSIT",
          recordKey: key,
          title: "Loan principal repayments",
          status: "CONFIRMED",
          accountId: bill.accountId,
          amountMinor: due.schedule.principalMinor,
          currency: bill.currency,
          occurredOn: paidOn,
          createdById: actor.user.id,
          details: {
            direction: "RECEIVED",
            counterparty: bill.vendor,
            refundable: true,
          },
        },
        update: {},
      });
      await tx.moneyControlMovement.create({
        data: {
          workspaceId: actor.workspace.id,
          recordId: record.id,
          accountId: bill.accountId,
          amountMinor: -principal,
          currency: bill.currency,
          occurredOn: paidOn,
          reference,
          operationKey: `emi-payment:${paymentId}`,
        },
      });
      await tx.moneyControlRecord.updateMany({
        where: { workspaceId: actor.workspace.id, id: record.id },
        data: { settledMinor: { increment: principal } },
      });
    }
  }
  if (due && bill.tdsMinor && bill.paidMinor + amount === bill.amountMinor) {
    const section =
      due.kind === "RENT"
        ? due.schedule?.tdsSection || "194-I"
        : due.schedule?.tdsSection || "";
    if (section) {
      const iso = paidOn.toISOString().slice(0, 10);
      await tx.moneyControlRecord.upsert({
        where: {
          workspaceId_kind_recordKey: {
            workspaceId: actor.workspace.id,
            kind: "TDS_DEDUCTION",
            recordKey: `recurring-tds:${bill.id}`,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          kind: "TDS_DEDUCTION",
          recordKey: `recurring-tds:${bill.id}`,
          title: "Recurring payment withholding",
          status: "RECORDED",
          amountMinor: bill.tdsMinor,
          currency: bill.currency,
          occurredOn: paidOn,
          payroll: bill.privatePayroll || section === "192",
          createdById: actor.user.id,
          details: {
            payee: bill.vendor,
            section,
            grossMinor:
              bill.taxableMinor +
              bill.cgstMinor +
              bill.sgstMinor +
              bill.igstMinor,
            fiscalYear: fiscalYear(iso),
            quarter: fiscalQuarter(iso),
          },
        },
        update: {},
      });
    }
  }
  return expense;
}
