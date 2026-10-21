import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveCentre } from "@/lib/finance/tools/service";
import {
  grantPayroll,
  savePayProfile,
  savePayRun,
  savePayBookkeeping,
  transitionPayRun,
  revealPayDetails,
} from "@/lib/finance/tools/payroll";
import { payrollData } from "@/lib/finance/tools/queries";
import { getLedgerEntry, ledgerWhere } from "@/lib/finance/queries";
import {
  owner,
  admin,
  member,
  foreign,
  categoryId,
  centreId,
  accountId,
  records,
} from "./fixtures";

export function registerPayrollApprovalsTests() {
  it("denies owners and admins until explicitly granted, and only owners may grant", async () => {
    await expect(payrollData(owner, { month: "2026-06" })).rejects.toThrow(
      "access",
    );
    await expect(payrollData(admin, { month: "2026-06" })).rejects.toThrow(
      "access",
    );
    await expect(
      grantPayroll(admin, { userId: admin.user.id, access: "MANAGE" }),
    ).rejects.toThrow("access");
    await grantPayroll(owner, { userId: owner.user.id, access: "MANAGE" });
    await grantPayroll(owner, { userId: admin.user.id, access: "MANAGE" });
  });
  it("encrypts PAN and bank references, audits reveals and rejects full bank account numbers", async () => {
    await expect(
      savePayProfile(owner, {
        name: "Denied",
        kind: "STAFF",
        rateMinor: 100,
        rateBasis: "MONTH",
        currency: "INR",
        bankLast4: "123456789",
      }),
    ).rejects.toThrow();
    const id = await savePayProfile(owner, {
      name: "Asha test",
      kind: "STAFF",
      rateMinor: 100000,
      rateBasis: "MONTH",
      currency: "INR",
      pan: "ABCDE1234F",
      bankLast4: "1234",
      ifsc: "SBIN0001234",
    });
    const row = await prisma.financePayProfile.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id },
    });
    expect(row.panEnc).not.toContain("ABCDE1234F");
    expect(row.bankEnc).not.toContain("1234");
    expect(await revealPayDetails(owner, id)).toMatchObject({
      pan: "ABCDE1234F",
      bank: { last4: "1234" },
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          targetId: id,
          action: "finance.payroll_viewed",
        },
      }),
    ).toBe(1);
    await expect(revealPayDetails(member, id)).rejects.toThrow("access");
    await expect(revealPayDetails(foreign, id)).rejects.toThrow("access");
    records.payRunId = await savePayRun(owner, {
      profileId: id,
      month: "2026-06",
      grossMinor: 100000,
      allowancesMinor: 10000,
      pfMinor: 1000,
      esiMinor: 500,
      ptMinor: 200,
      tdsMinor: 5000,
      advancesMinor: 10000,
      otherMinor: 300,
      accountId,
      categoryId,
      costCentreId: centreId,
    });
  });
  it("requires a distinct approver and posts a paid run to the ledger once", async () => {
    await expect(
      transitionPayRun(owner, { runId: records.payRunId, transition: "APPROVE" }),
    ).rejects.toThrow("another payroll manager");
    await transitionPayRun(admin, { runId: records.payRunId, transition: "APPROVE" });
    await expect(
      savePayRun(owner, {
        id: records.payRunId,
        profileId: "bad",
        month: "2026-06",
        grossMinor: 1,
      }),
    ).rejects.toThrow();
    await transitionPayRun(owner, {
      runId: records.payRunId,
      transition: "PAY",
      paidOn: "2026-06-20",
      reference: "UTR-PAY",
    });
    await Promise.all([
      transitionPayRun(owner, { runId: records.payRunId, transition: "POST" }),
      transitionPayRun(admin, { runId: records.payRunId, transition: "POST" }),
    ]);
    const rows = await prisma.ledgerEntry.findMany({
      where: {
        workspaceId: owner.workspace.id,
        sourceType: "finance_payroll",
        sourceId: records.payRunId,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountMinor: 93000,
      privatePayroll: true,
      costCentreId: centreId,
    });
    expect(await getLedgerEntry(owner.workspace.id, rows[0]!.id)).toBeNull();
    expect(
      await prisma.ledgerEntry.count({
        where: ledgerWhere(owner.workspace.id, {
          q: "",
          kind: null,
          categoryId: null,
          from: null,
          to: null,
          includeVoided: false,
        }),
      }),
    ).toBeGreaterThan(0);
  });
  it("lets payroll managers correct coding without changing pay amounts", async () => {
    const centre = await saveCentre(owner, {
      name: "Staff support programme",
      kind: "PROGRAMME",
    });
    await expect(
      savePayBookkeeping(member, {
        runId: records.payRunId,
        costCentreId: centre,
        accountId,
      }),
    ).rejects.toThrow("access");
    await savePayBookkeeping(owner, {
      runId: records.payRunId,
      costCentreId: centre,
      accountId,
      categoryId,
      purpose: "Monthly staff payment",
    });
    const run = await prisma.financePayRun.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: records.payRunId },
    });
    const ledger = await prisma.ledgerEntry.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: run.ledgerEntryId! },
    });
    expect(run).toMatchObject({
      grossMinor: 100000,
      netMinor: 93000,
      costCentreId: centre,
    });
    expect(ledger).toMatchObject({
      amountMinor: 93000,
      privatePayroll: true,
      costCentreId: centre,
      purpose: "Monthly staff payment",
    });
  });
}
