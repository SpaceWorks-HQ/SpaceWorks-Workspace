import "server-only";
import {
  recurringPaymentGate,
  recurringPaymentAccounting,
} from "@/lib/finance/recurring/payments";
import { prisma } from "@/lib/db";
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
} from "@/lib/finance/tools/access";
import { claimStagedFiles } from "@/lib/finance/tools/files";
import { financeNote } from "./notes";

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
