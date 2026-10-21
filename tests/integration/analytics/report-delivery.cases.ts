import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { savePreset } from "@/lib/analytics/service";
import { findDownloadableFile } from "@/lib/files";
import { owner, member, admin, records, domain } from "./fixtures";

export function registerReportDeliveryTests() {
  it("generates an owner-only private report pack and rechecks downloads after revocation", async () => {
    const { generatePack, packData } = await import("@/lib/analytics/packs"),
      { getObject } = await import("@/lib/storage"),
      { PDFDocument } = await import("pdf-lib");
    const pack = await packData(owner, records.presetId, "management");
    expect(
      pack.metrics.some((m) => m.id === "payroll" || m.id === "safeguarding"),
    ).toBe(false);
    expect(pack.metrics.find((m) => m.id === "help-volume")?.count).toBe(1);
    const pdf = await generatePack(owner, records.presetId, "management"),
      file = await findDownloadableFile(pdf.fileId, owner.user.id);
    expect(file).not.toBeNull();
    expect(await findDownloadableFile(pdf.fileId, admin.user.id)).toBeNull();
    const object = await getObject(file!.storageKey),
      bytes = object!.body;
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
    if (process.env.ANALYTICS_PDF_QA === "1") {
      const { writeFile } = await import("node:fs/promises");
      await writeFile("/tmp/analytics-management-report.pdf", bytes);
    }
    await expect(
      generatePack(member, records.presetId, "management"),
    ).rejects.toThrow();
  }, 60000);
  it("queues one monthly PDF per selected current admin and rechecks delivery permission", async () => {
    const { queueMonthlyReport, renderAnalyticsEmail } =
        await import("@/lib/analytics/email"),
      id = await savePreset(owner, {
        name: "Monthly email",
        query: {
          period: "last-month",
          currency: "INR",
          monthlyEmail: true,
          emailTo: [admin.user.id],
        },
        shared: true,
      }),
      month = new Date().toISOString().slice(0, 7);
    expect(await queueMonthlyReport(owner, id, month)).toBe(1);
    expect(await queueMonthlyReport(owner, id, month)).toBe(0);
    const jobs = await prisma.outboxMessage.findMany({
      where: {
        kind: "analytics.email",
        payload: { path: ["presetId"], equals: id },
      },
    });
    expect(jobs).toHaveLength(1);
    const rendered = await renderAnalyticsEmail(jobs[0].payload);
    expect(rendered.to).toBe(`admin${domain}`);
    expect(rendered.email.attachments?.[0].contentType).toBe("application/pdf");
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { role: "MEMBER" },
    });
    await expect(renderAnalyticsEmail(jobs[0].payload)).rejects.toThrow();
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { role: "ADMIN" },
    });
  }, 120000);
}
