import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { monthlyCashFlow } from "@/lib/finance/recurring/cash-flow";
import { owner } from "./fixtures";

export function registerCashFlowTests() {
  it("includes principal and deposit cash without treating them as expenses", async () => {
    const flow = await monthlyCashFlow(owner.workspace.id, {
      from: "2026-10-01",
      to: "2026-10-31",
      currency: "INR",
    });
    const expense = await prisma.ledgerEntry.aggregate({
      where: {
        workspaceId: owner.workspace.id,
        kind: "EXPENSE",
        voidedAt: null,
        occurredOn: {
          gte: new Date("2026-10-01"),
          lte: new Date("2026-10-31"),
        },
      },
      _sum: { amountMinor: true },
    });
    const movement = await prisma.moneyControlMovement.aggregate({
      where: {
        workspaceId: owner.workspace.id,
        amountMinor: { lt: 0 },
        record: { kind: "DEPOSIT" },
        occurredOn: {
          gte: new Date("2026-10-01"),
          lte: new Date("2026-10-31"),
        },
      },
      _sum: { amountMinor: true },
    });
    expect(flow[0]!.expenseMinor).toBe(
      (expense._sum.amountMinor ?? 0) - (movement._sum.amountMinor ?? 0),
    );
  });
}
