import "server-only";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  lockFinance,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { actualSchema } from "../rules";
import { note } from "./audit";

export async function confirmActual(actor: FinanceActor, input: unknown) {
  const v = actualSchema.parse(input);
  if (v.gstMinor || (v.igstMinor && (v.cgstMinor || v.sgstMinor)))
    throw new FinanceError(
      "Enter either CGST/SGST or IGST from the actual bill.",
    );
  v.gstMinor = v.cgstMinor + v.sgstMinor + v.igstMinor;
  if (
    v.gstMinor > 2147483647 ||
    v.amountMinor + v.tdsMinor - v.gstMinor > 2147483647
  )
    throw new FinanceError("Check the bill amount and tax components.");
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const bill = await tx.financeBill.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.billId },
      include: { recurringDue: true },
    });
    if (!bill) throw new FinanceError("That bill is unavailable.");
    await financeAccess(
      actor,
      bill.privatePayroll ? "PAY_MANAGE" : "MANAGE",
      tx,
    );
    if (bill.paidMinor)
      throw new FinanceError("Keep the details of a bill with payments.");
    if (!bill.recurringDue) throw new FinanceError("Choose a recurring bill.");
    if (v.tdsMinor > v.amountMinor)
      throw new FinanceError("TDS cannot exceed the bill amount.");
    if (
      bill.recurringDue.kind === "EMI" &&
      (v.principalMinor + v.interestMinor !== v.amountMinor ||
        v.gstMinor ||
        v.tdsMinor)
    )
      throw new FinanceError(
        "Principal plus interest must equal the EMI cash payment. Keep tax fields zero.",
      );
    if (bill.recurringDue.kind === "EMI" && bill.recurringDue.scheduleId) {
      const schedule = await tx.recurringCostSchedule.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: bill.recurringDue.scheduleId,
        },
      });
      const other = await tx.recurringCostDue.aggregate({
        where: {
          workspaceId: actor.workspace.id,
          scheduleId: bill.recurringDue.scheduleId,
          id: { not: bill.recurringDue.id },
        },
        _sum: { principalMinor: true },
      });
      if (
        !schedule ||
        v.principalMinor + (other._sum.principalMinor ?? 0) >
          schedule.principalMinor
      )
        throw new FinanceError(
          "The principal allocation exceeds the original loan principal.",
        );
    }
    if (v.amountMinor + v.tdsMinor - v.gstMinor < 0)
      throw new FinanceError("Check the taxable value and taxes.");
    await tx.financeBill.updateMany({
      where: { workspaceId: actor.workspace.id, id: bill.id },
      data: {
        amountMinor: v.amountMinor,
        taxableMinor: v.amountMinor + v.tdsMinor - v.gstMinor,
        cgstMinor: v.cgstMinor,
        sgstMinor: v.sgstMinor,
        igstMinor: v.igstMinor,
        tdsMinor: v.tdsMinor,
        needsActual: false,
      },
    });
    await tx.recurringCostDue.updateMany({
      where: { workspaceId: actor.workspace.id, billId: bill.id },
      data: {
        principalMinor: v.principalMinor,
        interestMinor: v.interestMinor,
        splitConfirmed: true,
      },
    });
    await checkFundRecord(
      tx,
      actor.workspace.id,
      actor.user.id,
      "bill",
      bill.id,
    );
    await note(tx, actor, bill.id, "actual_confirmed");
    return bill.id;
  });
}
