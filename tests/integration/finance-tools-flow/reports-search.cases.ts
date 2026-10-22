import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveFund, saveBill, payBill } from "@/lib/finance/tools/service";
import { uploadFinanceFiles } from "@/lib/finance/tools/files";
import { financeCsv } from "@/lib/finance/tools/export";
import { spendingReview } from "@/lib/finance/tools/queries";
import { searchDocuments } from "@/lib/search/query";
import { suffix, owner, foreign, bill, receipt } from "./fixtures";

export function registerReportsSearchTests() {
  it("inherits bill proof in spending reports and escapes accountant CSV cells", async () => {
    const id = await saveBill(owner, bill({ vendor: "=SUM(1,2)" }));
    const [file] = await uploadFinanceFiles(owner, "BILL", id, [receipt()]);
    const payment = await payBill(owner, {
      billId: id,
      paymentKey: randomUUID(),
      amountMinor: 10000,
      paidOn: "2026-06-11",
      reference: "UTR-11",
    });
    const data = await spendingReview(owner, { month: "2026-06" });
    const row = data.entries.find((e) => e.sourceId === payment)!;
    expect(row.receipts.map((r) => r.id)).toContain(file!.id);
    expect(data.missingReceipts.some((e) => e.id === row.id)).toBe(false);
    expect(await financeCsv(owner, "bills", { month: "2026-06" })).toContain(
      "'=SUM(1,2)",
    );
  });
  it("indexes finance records privately and applies live finance permissions in search", async () => {
    const id = await saveFund(owner, {
      name: `UniqueFinance${suffix}`,
      currency: "INR",
    });
    const doc = await prisma.searchDocument.findFirstOrThrow({
      where: { entityId: id, workspaceId: owner.workspace.id },
    });
    expect(doc.visibility).toBe("PRIVATE");
    const hits = await searchDocuments(
      { workspaceId: owner.workspace.id, userId: owner.user.id, role: "OWNER" },
      `UniqueFinance${suffix}`,
    );
    expect(hits.some((h) => h.entityId === id)).toBe(true);
    expect(
      await searchDocuments(
        {
          workspaceId: foreign.workspace.id,
          userId: foreign.user.id,
          role: "OWNER",
        },
        `UniqueFinance${suffix}`,
      ),
    ).toEqual([]);
  });
}
