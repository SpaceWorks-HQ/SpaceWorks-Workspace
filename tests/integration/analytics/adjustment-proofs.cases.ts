import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { saveAdjustment, attachAdjustmentFiles } from "@/lib/analytics/service";
import { cashForecast } from "@/lib/analytics/forecast";
import { findDownloadableFile } from "@/lib/files";
import { canDownloadAnalyticsFile } from "@/lib/analytics/files";
import { type Actor } from "@/lib/analytics/access";
import { owner, member, outside, records } from "./fixtures";

export function registerAdjustmentProofTests() {
  it("deduplicates forecast reminders across concurrent worker ticks", async () => {
    const { run } = await import("@/lib/scheduled/analytics"),
      { localDate } = await import("@/lib/finance/dates"),
      date = new Date();
    const id = await saveAdjustment(owner, {
      title: "Review assumption",
      dueOn: localDate(date, owner.workspace.timezone),
      amountMinor: -100,
      currency: "INR",
    });
    await Promise.all([run(date), run(date)]);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "analytics.assumption_due",
          dedupeKey: { contains: id },
        },
      }),
    ).toBe(1);
  });
  it("stores multiple proof files only through private storage and denies orphans", async () => {
    const { PDFDocument } = await import("pdf-lib"),
      pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save(),
      ids = await attachAdjustmentFiles(owner, records.adjustmentId, [
        new File([new Uint8Array(bytes)], "proof.pdf", {
          type: "application/pdf",
        }),
        new File([new Uint8Array(bytes)], "quote.pdf", {
          type: "application/pdf",
        }),
      ]);
    expect(ids).toHaveLength(2);
    expect(await findDownloadableFile(ids[0], owner.user.id)).not.toBeNull();
    expect(await findDownloadableFile(ids[0], member.user.id)).toBeNull();
    expect(await findDownloadableFile(ids[0], outside.user.id)).toBeNull();
    expect(
      await canDownloadAnalyticsFile(
        {
          id: "orphan",
          workspaceId: owner.workspace.id,
          folder: "/analytics/reports",
        },
        owner.user.id,
        "OWNER",
      ),
    ).toBe(false);
  });
  it("indexes adjustment titles with a live admin gate and keeps missing opening balances explicit", async () => {
    const { searchDocuments } = await import("@/lib/search/query"),
      search = (a: Actor) => ({
        workspaceId: a.workspace.id,
        userId: a.user.id,
        role: a.membership.role,
      });
    expect(
      (await searchDocuments(search(owner), "Printer replacement")).some(
        (r) => r.entityId === records.adjustmentId,
      ),
    ).toBe(true);
    expect(
      (await searchDocuments(search(member), "Printer replacement")).some(
        (r) => r.entityId === records.adjustmentId,
      ),
    ).toBe(false);
    const empty = await cashForecast(outside, { currency: "INR" });
    expect(empty.openingKnown).toBe(false);
    expect(empty.warnings.some((w) => w.includes("No finance accounts"))).toBe(
      true,
    );
  });
}
