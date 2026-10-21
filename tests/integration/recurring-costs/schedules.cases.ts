import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveSchedule,
} from "@/lib/finance/recurring/service";
import { upcomingView } from "@/lib/finance/recurring/queries";
import {
  owner,
  person,
  guest,
  categoryId,
  foreignFund,
  schedule,
  generate,
  records,
} from "./fixtures";

export function registerScheduleTests() {
  it("rejects forged roles, guests and cross-workspace tags", async () => {
    await expect(
      saveSchedule({ ...person, membership: { role: "OWNER" } }, schedule()),
    ).rejects.toThrow(/access/);
    await expect(saveSchedule(guest, schedule())).rejects.toThrow(/access/);
    await expect(
      saveSchedule(owner, schedule({ fundId: foreignFund })),
    ).rejects.toThrow(/fund/);
  });
  it("creates a schedule and generates each period once under concurrent claims", async () => {
    records.scheduleId = await saveSchedule(owner, schedule());
    await Promise.all([generate(records.scheduleId), generate(records.scheduleId)]);
    const dues = await prisma.recurringCostDue.findMany({
      where: { workspaceId: owner.workspace.id, scheduleId: records.scheduleId },
      include: { bill: true },
    });
    expect(dues).toHaveLength(2);
    expect(dues[0]!.bill.amountMinor).toBe(4500000);
    expect(dues[0]!.bill.categoryId).toBe(categoryId);
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(0);
  });
  it("retains future projections in 90-day view without issuing early bills", async () => {
    const v = await upcomingView(owner, { days: "90" });
    expect(v.all.some((r) => r.scheduleId === records.scheduleId && r.projected)).toBe(
      true,
    );
    expect(v.all[0]!.dueOn <= v.all.at(-1)!.dueOn).toBe(true);
  });
  it("keeps source timing immutable once bills exist", async () => {
    const s = await prisma.recurringCostSchedule.findFirstOrThrow({
      where: { id: records.scheduleId },
    });
    await expect(
      saveSchedule(owner, {
        ...s,
        startsOn: "2026-10-01",
        endsOn: null,
        renewalOn: null,
        dueDay: 2,
      }),
    ).rejects.toThrow(/timing/);
  });
}
