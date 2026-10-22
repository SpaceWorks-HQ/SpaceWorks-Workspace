import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveAdjustment } from "@/lib/analytics/service";
import { cashForecast } from "@/lib/analytics/forecast";
import { owner, member, records } from "./fixtures";

export function registerAdjustmentForecastTests() {
  it("keeps one-off adjustments separate from the ledger and forecasts opening cash once", async () => {
    const before = await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
      date = new Date();
    date.setUTCDate(date.getUTCDate() + 2);
    records.adjustmentId = await saveAdjustment(owner, {
      title: "Printer replacement",
      dueOn: date.toISOString().slice(0, 10),
      amountMinor: -2500,
      currency: "INR",
    });
    const f = await cashForecast(
      owner,
      { currency: "INR" },
      new Date("2026-10-21T12:00:00Z"),
    );
    expect(f.openingMinor).toBe(120000);
    expect(
      f.lines.some((l) => l.id === records.billId && l.amountMinor === -2000),
    ).toBe(true);
    expect(f.weekly).toHaveLength(12);
    expect(f.monthly).toHaveLength(6);
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(before);
    await expect(
      saveAdjustment(member, {
        title: "Unauthorized",
        dueOn: "2026-11-01",
        amountMinor: 100,
        currency: "INR",
      }),
    ).rejects.toThrow();
    await expect(
      saveAdjustment(owner, {
        title: "Foreign reference",
        dueOn: "2026-11-01",
        amountMinor: 100,
        currency: "INR",
        fundId: "foreign",
      }),
    ).rejects.toThrow();
  });
}
