import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addEntry, saveEntryTags } from "@/lib/finance/tools/service";
import {
  addAccount,
  accountBalance,
  startMonth,
  saveStep,
  reconcileAccount,
  markReconciled,
  closeMonth,
  reviewSpending,
} from "@/lib/finance/tools/close";
import { generateReportPdf } from "@/lib/finance/tools/report-pdf";
import { findDownloadableFile } from "@/lib/files";
import { createLedgerEntry } from "@/lib/finance/service";
import { ledgerEntrySchema } from "@/lib/finance/schemas";
import { GET as csvRoute } from "@/app/w/[workspaceSlug]/finance/export/[kind]/route";
import { dateOnly } from "@/lib/finance/dates";
import { session, owner, member, guest, entry } from "./fixtures";

export function registerMonthCloseExportsTests() {
  it("compares manual statements, requires reconciliation marks and locks signed periods", async () => {
    const account = await addAccount(owner, {
      name: "May cash",
      currency: "INR",
      openingMinor: 10000,
      openingOn: "2026-05-01",
    });
    const e = await addEntry(
      owner,
      entry({
        accountId: account,
        occurredOn: "2026-05-10",
        amountMinor: 2500,
      }),
    );
    expect(
      (
        await accountBalance(
          prisma,
          owner.workspace.id,
          account,
          dateOnly("2026-05-31"),
        )
      ).balanceMinor,
    ).toBe(7500);
    await expect(
      reconcileAccount(owner, {
        accountId: account,
        upTo: "2026-05-31",
        statementMinor: 8000,
        signOff: true,
      }),
    ).rejects.toThrow("differ");
    await expect(
      reconcileAccount(owner, {
        accountId: account,
        upTo: "2026-05-31",
        statementMinor: 7500,
        signOff: true,
      }),
    ).rejects.toThrow("every entry");
    await markReconciled(owner, { entryId: e, reconciled: true });
    await reconcileAccount(owner, {
      accountId: account,
      upTo: "2026-05-31",
      statementMinor: 7500,
      signOff: true,
    });
    await expect(
      saveEntryTags(owner, {
        entryId: e,
        accountId: account,
        incomeSource: "OTHER",
      }),
    ).rejects.toThrow("reconciled");
  });
  it("signs a complete month, prevents old and new ledger edits, and can reopen it", async () => {
    const month = await startMonth(owner, { month: "2025-12" });
    await expect(closeMonth(owner, { month: "2025-12" })).rejects.toThrow(
      "Complete",
    );
    const steps = await prisma.financeMonthStep.findMany({
      where: { workspaceId: owner.workspace.id, monthId: month },
    });
    for (const step of steps)
      await saveStep(owner, {
        id: step.id,
        month: "2025-12",
        title: step.title,
        done: true,
      });
    await reviewSpending(owner, { month: "2025-12", notes: "No transactions" });
    await closeMonth(owner, { month: "2025-12" });
    await expect(
      addEntry(owner, entry({ occurredOn: "2025-12-05", accountId: null })),
    ).rejects.toThrow("signed off");
    const old = await createLedgerEntry(
      owner,
      ledgerEntrySchema.parse({
        kind: "EXPENSE",
        amount: "1",
        occurredOn: "2025-12-05",
        description: "Should fail",
      }),
      null,
    );
    expect(old.ok).toBe(false);
    await closeMonth(owner, { month: "2025-12", reopen: true });
    expect(
      await addEntry(
        owner,
        entry({ occurredOn: "2025-12-05", accountId: null }),
      ),
    ).toBeTruthy();
  });
  it("stores report PDFs and links them to the month", async () => {
    const id = await generateReportPdf(owner, { month: "2026-06" });
    const row = await prisma.financeAttachment.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, fileId: id },
    });
    expect(row.recordType).toBe("MONTH");
    expect(await findDownloadableFile(id, guest.user.id)).toBeNull();
    expect(await findDownloadableFile(id, owner.user.id)).not.toBeNull();
  }, 60000);
  it.each([
    ["", 404],
    ["guest", 404],
    ["member", 404],
    ["owner", 200],
  ])("CSV export checks %s access", async (role, status) => {
    session.id =
      role === "owner"
        ? owner.user.id
        : role === "member"
          ? member.user.id
          : role === "guest"
            ? guest.user.id
            : "";
    const response = await csvRoute(
      new Request(
        `http://localhost/w/${owner.workspace.slug}/finance/export/entries?month=2026-06`,
      ),
      {
        params: Promise.resolve({
          workspaceSlug: owner.workspace.slug,
          kind: "entries",
        }),
      },
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
}
