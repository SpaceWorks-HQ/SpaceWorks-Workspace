import { it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import { cashForecast, forecastDrill } from "@/lib/analytics/forecast";
import { owner, result } from "./fixtures";

export function registerFundingForecastTests() {
  it("uses the linked funding kind to select the BOM award denominator", async () => {
    for (const kind of ["GRANT", "OPPORTUNITY"] as const) {
      const award = await prisma.fundingRecord.create({ data: {
        workspaceId: owner.workspace.id, kind, title: `${kind} award`, status: "AWARDED",
        amountMinor: kind === "GRANT" ? 10000 : 0, details: { awardedMinor: 20000 },
      } });
      const estimate = await prisma.productRecord.create({ data: {
        workspaceId: owner.workspace.id, kind: "ESTIMATE", title: `${kind} BOM`,
        status: "DRAFT", fundingId: award.id, createdById: owner.user.id,
        createdAt: new Date("2026-10-01"),
      } });
      await prisma.productEstimateRevision.create({ data: {
        workspaceId: owner.workspace.id, recordId: estimate.id, version: 1,
        createdById: owner.user.id,
        snapshot: { details: { lines: [{ quantityMilli: 1000, unitCostMinor: 5000, gstBps: 0 }], contingencyBps: 0 } },
      } });
    }
    const m = await result(owner, "bom");
    expect(m.groups.find((g) => g.label === "GRANT BOM")).toMatchObject({ value: 50, base: 10000 });
    expect(m.groups.find((g) => g.label === "OPPORTUNITY BOM")).toMatchObject({ value: 25, base: 20000 });
  });
  it("matches month-end forecast drill rows to the chart bucket boundaries", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-30T12:00:00Z"));
    try {
      for (const date of ["2026-02-28", "2026-03-28", "2026-03-30", "2026-03-31"])
        await prisma.analyticsAdjustment.create({ data: {
          workspaceId: owner.workspace.id, title: `Month-end ${date}`, dueOn: new Date(date),
          amountMinor: -100, currency: "EUR", createdById: owner.user.id,
        } });
      const forecast = await cashForecast(owner, { currency: "EUR" }),
        drill = await forecastDrill(owner, { currency: "EUR", cadence: "month", bucket: forecast.monthly[1].label });
      expect(drill.period).toEqual({ from: "2026-02-28", to: "2026-03-30" });
      expect(drill.rows.map((r) => r.date).sort()).toEqual(["2026-02-28", "2026-03-28", "2026-03-30"]);
      expect(drill.rows.reduce((sum, r) => sum - r.value, 0)).toBe(forecast.monthly[1].expenseMinor);
    } finally { vi.useRealTimers(); }
  });
  it("sorts trend buckets chronologically across category order", async () => {
    await prisma.ledgerEntry.createMany({ data: [
      { workspaceId: owner.workspace.id, kind: "INCOME", amountMinor: 100, currency: "EUR",
        description: "Later first category", incomeSource: "A", occurredOn: new Date("2026-10-20") },
      { workspaceId: owner.workspace.id, kind: "INCOME", amountMinor: 200, currency: "EUR",
        description: "Earlier last category", incomeSource: "Z", occurredOn: new Date("2026-10-02") },
    ] });
    const m = await result(owner, "income", { currency: "EUR" });
    expect(m.trend.map((p) => [p.label, p.value])).toEqual([["2026-10-02", 200], ["2026-10-20", 100]]);
  });
}
