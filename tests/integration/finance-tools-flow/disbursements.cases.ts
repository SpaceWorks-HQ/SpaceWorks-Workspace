import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveDisbursement, transitionDisbursement } from "@/lib/finance/tools/disbursements";
import { uploadFinanceFiles } from "@/lib/finance/tools/files";
import { decide } from "@/lib/approvals/engine";
import { owner, admin, categoryId, centreId, accountId, receipt } from "./fixtures";

export function registerDisbursementsTests() {
  it("uses existing approvals and tracks advance settlement without a second expense", async () => {
    const id = await saveDisbursement(owner, {
      payee: "Programme volunteer",
      purpose: "Travel advance",
      kind: "ADVANCE",
      amountMinor: 10000,
      currency: "INR",
      accountId,
      categoryId,
      costCentreId: centreId,
    });
    await expect(
      transitionDisbursement(owner, {
        id,
        transition: "PAY",
        paidOn: "2026-06-21",
        reference: "UTR-ADV",
      }),
    ).rejects.toThrow("Approve");
    await transitionDisbursement(owner, { id, transition: "REQUEST_APPROVAL" });
    const row = await prisma.financeDisbursement.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id },
    });
    expect(
      (
        await decide(admin, {
          requestId: row.approvalId!,
          decision: "APPROVED",
        })
      ).ok,
    ).toBe(true);
    await transitionDisbursement(owner, {
      id,
      transition: "PAY",
      paidOn: "2026-06-21",
      reference: "UTR-ADV",
    });
    await expect(
      transitionDisbursement(owner, {
        id,
        transition: "SETTLE",
        paidOn: "2026-06-25",
        settledMinor: 10000,
      }),
    ).rejects.toThrow("proof");
    await uploadFinanceFiles(owner, "DISBURSEMENT", id, [receipt()]);
    await transitionDisbursement(owner, {
      id,
      transition: "SETTLE",
      paidOn: "2026-06-25",
      settledMinor: 10000,
    });
    expect(
      (
        await prisma.financeDisbursement.findFirstOrThrow({
          where: { workspaceId: owner.workspace.id, id },
        })
      ).settledMinor,
    ).toBe(10000);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          workspaceId: owner.workspace.id,
          sourceType: "finance_disbursement",
          sourceId: id,
        },
      }),
    ).toBe(1);
  });
}
