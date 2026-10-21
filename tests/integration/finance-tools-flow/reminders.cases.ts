import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addEntry, saveBudget, saveBill } from "@/lib/finance/tools/service";
import { run as reminders } from "@/lib/scheduled/financeTools";
import { run as opsReminders } from "@/lib/scheduled/opsMoney";
import { owner, admin, categoryId, entry, bill } from "./fixtures";

export function registerRemindersTests() {
  it("emits overdue bills once per day and budget thresholds at 80 and 100 percent", async () => {
    const b = await saveBill(owner, bill({ ownerId: admin.user.id }));
    const budget = await saveBudget(owner, {
      name: "Budget alert",
      amountMinor: 100,
      currency: "INR",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      categoryId,
    });
    await addEntry(owner, entry({ amountMinor: 100 }));
    await reminders(new Date("2026-06-15T10:00:00Z"));
    await reminders(new Date("2026-06-15T10:00:00Z"));
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "finance.bill.overdue",
          payload: { path: ["data", "billId"], equals: b },
        },
      }),
    ).toBe(1);
    await opsReminders(new Date("2026-06-15T10:00:00Z"));
    await opsReminders(new Date("2026-06-15T10:00:00Z"));
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "budget.threshold",
          payload: { path: ["data", "budgetId"], equals: budget },
        },
      }),
    ).toBe(2);
  });
}
