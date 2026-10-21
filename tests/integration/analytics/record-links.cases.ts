import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { drillRecords } from "@/lib/analytics/queries";
import { toolLists } from "@/lib/finance/tools/queries";
import { owner, q } from "./fixtures";

export function registerRecordLinkTests() {
  it("opens exact budget and fund records through their existing anchors", async () => {
    const ws = owner.workspace.id,
      fund = await prisma.financeFund.create({ data: {
        workspaceId: ws, name: "Linked grant fund", restricted: true, createdAt: new Date("2026-10-01"),
      } }),
      budget = await prisma.budget.findFirstOrThrow({ where: { workspaceId: ws } }),
      actor = { ...owner, user: { ...owner.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    await prisma.fundingRecord.create({ data: {
      workspaceId: ws, kind: "GRANT", title: "Linked grant", status: "ACTIVE", fundId: fund.id,
    } });
    await prisma.financeFund.create({ data: { workspaceId: ws, name: "Other fund" } });
    await prisma.budget.create({ data: {
      workspaceId: ws, name: "Other budget", amountMinor: 1000,
      periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"),
    } });
    const budgets = await toolLists(actor, "budgets", { record: budget.id }),
      funds = await toolLists(actor, "funds", { record: fund.id });
    expect(budgets.budgets.map((r) => r.id)).toEqual([budget.id]);
    expect(funds.funds.map((r) => r.id)).toEqual([fund.id]);
    expect((await toolLists(actor, "budgets", {})).budgets.length).toBeGreaterThan(1);
    expect((await toolLists(actor, "funds", {})).funds.length).toBeGreaterThan(1);
    expect((await toolLists(actor, "funds", { record: "foreign-record" })).funds).toEqual([]);
    expect((await toolLists(actor, "budgets", { record: "foreign-record" })).budgets).toEqual([]);
    expect((await drillRecords(owner, "budgets", q)).rows.find((r) => r.id === budget.id)?.path)
      .toBe(`/w/${owner.workspace.slug}/finance/budgets?record=${budget.id}#${budget.id}`);
    expect((await drillRecords(owner, "grant-utilisation", q)).rows.find((r) => r.id === fund.id)?.path)
      .toBe(`/w/${owner.workspace.slug}/finance/funds?record=${fund.id}#${fund.id}`);
  });
}
