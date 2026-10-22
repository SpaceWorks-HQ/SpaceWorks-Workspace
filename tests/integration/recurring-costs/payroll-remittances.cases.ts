import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  createRemittances,
} from "@/lib/finance/recurring/service";
import { financeCsv } from "@/lib/finance/tools/export";
import { payBill } from "@/lib/finance/tools/service";
import { savePayRun, transitionPayRun } from "@/lib/finance/tools/payroll";
import { uploadFinanceFiles } from "@/lib/finance/tools/files";
import { findDownloadableFile } from "@/lib/files";
import {
  owner,
  manager,
  categoryId,
  accountId,
  profileId,
  pdf,
  records,
} from "./fixtures";

export function registerPayrollRemittanceTests() {
  it("creates all four remittances atomically when a pay run is paid", async () => {
    records.runId = await savePayRun(owner, {
      profileId,
      month: "2026-09",
      grossMinor: 3000000,
      pfMinor: 180000,
      esiMinor: 22500,
      ptMinor: 20000,
      tdsMinor: 100000,
      advancesMinor: 500000,
      accountId,
      categoryId,
    });
    await transitionPayRun(manager, { runId: records.runId, transition: "APPROVE" });
    await transitionPayRun(owner, {
      runId: records.runId,
      transition: "PAY",
      paidOn: "2026-10-01",
      reference: "Salary",
    });
    await prisma.$transaction(async (tx) =>
      createRemittances(
        tx,
        await tx.financePayRun.findFirstOrThrow({ where: { id: records.runId } }),
      ),
    );
    const dues = await prisma.recurringCostDue.findMany({
      where: { workspaceId: owner.workspace.id, payRunId: records.runId },
      include: { bill: true },
    });
    expect(dues).toHaveLength(4);
    expect(dues.every((d) => d.bill.privatePayroll)).toBe(true);
    expect(
      dues.find((d) => d.kind === "SALARY_TDS")!.dueOn.toISOString(),
    ).toContain("2026-10-07");
  });
  it("keeps payroll bills out of general CSV and revokes private proof downloads", async () => {
    const due = await prisma.recurringCostDue.findFirstOrThrow({
      // The statutory payment test below needs its salary-tax bill without proof.
      where: {
        workspaceId: owner.workspace.id,
        payRunId: records.runId,
        kind: { not: "SALARY_TDS" },
      },
    });
    const [file] = await uploadFinanceFiles(owner, "BILL", due.billId, [pdf()]);
    expect(await findDownloadableFile(file!.id, owner.user.id)).not.toBeNull();
    await prisma.financePayrollGrant.deleteMany({
      where: { workspaceId: owner.workspace.id, userId: owner.user.id },
    });
    expect(await findDownloadableFile(file!.id, owner.user.id)).toBeNull();
    await expect(
      payBill(owner, {
        billId: due.billId,
        paymentKey: randomUUID(),
        amountMinor: 1,
        paidOn: "2026-10-21",
        reference: "No access",
      }),
    ).rejects.toThrow(/access/);
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    expect(
      await financeCsv(owner, "bills", {
        from: "2026-09-01",
        to: "2026-12-31",
      }),
    ).not.toContain(due.kind + "-2026-09");
  });
  it("requires challans and records statutory paid dates and private ledger postings", async () => {
    const due = await prisma.recurringCostDue.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        payRunId: records.runId,
        kind: "SALARY_TDS",
      },
      include: { bill: true },
    });
    const p = {
      billId: due.billId,
      paymentKey: randomUUID(),
      amountMinor: due.bill.amountMinor,
      paidOn: "2026-10-21",
      reference: "Challan 192",
      post: true,
    };
    await expect(payBill(owner, p)).rejects.toThrow(/challan/);
    await uploadFinanceFiles(owner, "BILL", due.billId, [pdf()]);
    const id = await payBill(manager, p);
    expect(
      await prisma.ledgerEntry.findFirst({
        where: { workspaceId: owner.workspace.id, sourceId: id },
      }),
    ).toMatchObject({ privatePayroll: true, amountMinor: 100000 });
  });
}
