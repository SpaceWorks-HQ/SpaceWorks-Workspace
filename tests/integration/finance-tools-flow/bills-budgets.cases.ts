import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { addEntry, saveBudget, saveBill, payBill, budgetActual } from "@/lib/finance/tools/service";
import { dateOnly } from "@/lib/finance/dates";
import { owner, admin, categoryId, centreId, entry, bill } from "./fixtures";

export function registerBillsBudgetsTests() {
  it("counts budget category actuals across unlinked entries, excluding voids and other currencies", async () => {
    const id = await saveBudget(owner, {
      name: "June office line",
      amountMinor: 100000,
      currency: "INR",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      categoryId,
      costCentreId: centreId,
      varianceNote: "Annual purchase",
    });
    const ledger = await addEntry(owner, entry());
    await prisma.ledgerEntry.create({
      data: {
        workspaceId: owner.workspace.id,
        kind: "EXPENSE",
        currency: "USD",
        amountMinor: 99999,
        description: "Other currency",
        categoryId,
        costCentreId: centreId,
        occurredOn: dateOnly("2026-06-10"),
      },
    });
    const b = await prisma.budget.findFirstOrThrow({
      where: { id, workspaceId: owner.workspace.id },
    });
    expect(await budgetActual(prisma, b)).toBe(10000);
    await prisma.ledgerEntry.updateMany({
      where: { id: ledger, workspaceId: owner.workspace.id },
      data: { voidedAt: new Date() },
    });
    expect(await budgetActual(prisma, b)).toBe(0);
  });
  it("records partial bill payments and posts one expense per payment under retries", async () => {
    const id = await saveBill(owner, bill());
    const v = {
      billId: id,
      paymentKey: randomUUID(),
      amountMinor: 10000,
      paidOn: "2026-06-10",
      reference: "UTR-10",
    };
    const results = await Promise.all([payBill(owner, v), payBill(admin, v)]);
    expect(results[0]).toBe(results[1]);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          workspaceId: owner.workspace.id,
          sourceType: "finance_bill_payment",
          sourceId: results[0],
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.financeBill.findFirstOrThrow({
          where: { id, workspaceId: owner.workspace.id },
        })
      ).paidMinor,
    ).toBe(10000);
    await expect(payBill(owner, { ...v, amountMinor: 10001 })).rejects.toThrow(
      "already used",
    );
    await expect(
      payBill(owner, { ...v, paymentKey: randomUUID(), amountMinor: 20001 }),
    ).rejects.toThrow("exceeds");
    await payBill(owner, {
      ...v,
      paymentKey: randomUUID(),
      amountMinor: 20000,
      post: false,
    });
    expect(
      (
        await prisma.financeBill.findFirstOrThrow({
          where: { id, workspaceId: owner.workspace.id },
        })
      ).paidMinor,
    ).toBe(30000);
  });
}
