import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  saveSchedule,
  confirmActual,
} from "@/lib/finance/recurring/service";
import { payBill } from "@/lib/finance/tools/service";
import { owner, outsider, schedule, generate, records } from "./fixtures";

export function registerUtilityTaxPaymentTests() {
  it("requires actual utility amount, then uses ordinary idempotent partial payments", async () => {
    const id = await saveSchedule(
      owner,
      schedule({
        title: "Electricity",
        kind: "ELECTRICITY",
        estimated: true,
        amountMinor: 800000,
      }),
    );
    await generate(id);
    records.utilityBill = (
      await prisma.recurringCostDue.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, scheduleId: id },
      })
    ).billId;
    const payment = {
      billId: records.utilityBill,
      paymentKey: randomUUID(),
      amountMinor: 450000,
      paidOn: "2026-10-21",
      reference: "Power bill",
      post: true,
    };
    await expect(payBill(owner, payment)).rejects.toThrow(/actual/);
    await confirmActual(owner, { billId: records.utilityBill, amountMinor: 900000 });
    const ids = await Promise.all([
      payBill(owner, payment),
      payBill(owner, payment),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(
      (
        await prisma.financeBill.findFirstOrThrow({
          where: { id: records.utilityBill },
        })
      ).paidMinor,
    ).toBe(450000);
    await expect(payBill(outsider, payment)).rejects.toThrow(/unavailable/);
  });
  it("requires reviewed GST components instead of inferring a place of supply", async () => {
    const id = await saveSchedule(
      owner,
      schedule({ title: "Taxable office rent", gstPercent: 18 }),
    );
    await generate(id);
    const due = await prisma.recurringCostDue.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, scheduleId: id },
      include: { bill: true },
    });
    expect(due.bill).toMatchObject({
      needsActual: true,
      amountMinor: 5310000,
      igstMinor: 0,
    });
    await confirmActual(owner, {
      billId: due.billId,
      amountMinor: 5310000,
      cgstMinor: 405000,
      sgstMinor: 405000,
    });
    expect(
      await prisma.financeBill.findFirst({
        where: { workspaceId: owner.workspace.id, id: due.billId },
      }),
    ).toMatchObject({
      needsActual: false,
      taxableMinor: 4500000,
      cgstMinor: 405000,
      sgstMinor: 405000,
      igstMinor: 0,
    });
    await expect(
      confirmActual(owner, {
        billId: due.billId,
        amountMinor: 5310000,
        cgstMinor: 405000,
        igstMinor: 405000,
      }),
    ).rejects.toThrow(/either/);
  });
}
