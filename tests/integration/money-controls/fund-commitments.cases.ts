import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { fundAssessment } from "@/lib/moneyControls/funds";
import { addEntry, saveBill, payBill, saveEntryTags } from "@/lib/finance/tools/service";
import { saveDisbursement } from "@/lib/finance/tools/disbursements";
import { savePayProfile, savePayRun, grantPayroll } from "@/lib/finance/tools/payroll";
import { searchDocuments, canAccessResource } from "@/lib/search/query";
import { suffix, actor, member, bank, category, on, save, fund, expense } from "./fixtures";

export function registerFundCommitmentsTests() {
  it("checks fund categories and periods, including concurrent expense limits", async () => {
    const f = await fund("Concurrent", 10000);
    const outcomes = await Promise.allSettled([
      addEntry(actor, expense(f, 6000)),
      addEntry(actor, expense(f, 6000)),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    await expect(
      addEntry(actor, expense(f, 100, { occurredOn: "2027-04-01" })),
    ).rejects.toThrow(/period/);
    await expect(
      addEntry(actor, expense(f, 100, { categoryId: null })),
    ).rejects.toThrow(/categories/);
  });
  it("replaces bill reservations with payments and blocks duplicate expense references across funds", async () => {
    const f = await fund("Bill reserve", 20000),
      f2 = await fund("Second grant", 20000),
      number = `B-${suffix}`;
    const bill = await saveBill(actor, {
      vendor: "Supplier",
      number,
      issuedOn: on,
      dueOn: "2026-06-30",
      currency: "INR",
      amountMinor: 15000,
      fundId: f,
      categoryId: category,
    });
    await payBill(actor, {
      billId: bill,
      paymentKey: randomUUID(),
      amountMinor: 6000,
      paidOn: on,
      reference: "Part payment",
      post: true,
    });
    expect(
      (await fundAssessment(prisma, actor.workspace.id)).find(
        (x) => x.rule.fundId === f,
      )?.committedMinor,
    ).toBe(15000);
    await expect(
      addEntry(
        actor,
        expense(f2, 1000, { counterparty: "Supplier", invoiceNumber: number }),
      ),
    ).rejects.toThrow(/already charged/);
  });
  it("checks payroll and disbursement commitments and persists warnings", async () => {
    const f = await fund("Payroll restriction", 1000);
    await grantPayroll(actor, { userId: actor.user.id, access: "MANAGE" });
    const profile = await savePayProfile(actor, {
      name: "Payee",
      kind: "STAFF",
      currency: "INR",
      rateMinor: 2000,
      rateBasis: "MONTH",
    });
    await expect(
      savePayRun(actor, {
        profileId: profile,
        month: "2026-06",
        grossMinor: 2000,
        fundId: f,
        categoryId: category,
      }),
    ).rejects.toThrow(/budget/);
    await expect(
      saveDisbursement(actor, {
        payee: "Volunteer",
        purpose: "Office travel",
        kind: "ADVANCE",
        currency: "INR",
        amountMinor: 2000,
        fundId: f,
        categoryId: category,
        dueOn: on,
      }),
    ).rejects.toThrow(/budget/);
    const warned = await fund("Warn only", 1000, { budgetMode: "WARN" });
    await addEntry(actor, expense(warned, 2000));
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: actor.workspace.id,
          action: "moneycontrols.fund_warning",
        },
      }),
    ).toBeGreaterThan(0);
  });
  it("checks retagging without trusting the client and preserves source privacy in search", async () => {
    const f = await fund("Retag", 10),
      entry = await addEntry(actor, { ...expense(f, 20), fundId: null });
    await expect(
      saveEntryTags(actor, {
        entryId: entry,
        fundId: f,
        categoryId: category,
        incomeSource: "OTHER",
      }),
    ).rejects.toThrow(/budget/);
    const id = await save("DEPOSIT", {
      title: `Private controls ${suffix}`,
      accountId: bank,
      amountMinor: 100,
      details: { direction: "GIVEN", counterparty: "Office" },
    });
    expect(
      await canAccessResource(
        {
          workspaceId: actor.workspace.id,
          userId: actor.user.id,
          role: "OWNER",
        },
        "money_control",
        id,
      ),
    ).toBe(true);
    expect(
      await searchDocuments(
        {
          workspaceId: actor.workspace.id,
          userId: member.user.id,
          role: "MEMBER",
        },
        `Private controls ${suffix}`,
      ),
    ).toHaveLength(0);
  });
}
