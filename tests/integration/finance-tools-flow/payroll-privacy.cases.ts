import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { financeAccess } from "@/lib/finance/tools/access";
import { grantPayroll, savePayProfile } from "@/lib/finance/tools/payroll";
import { generatePayslip } from "@/lib/finance/tools/pdf";
import { financeReports, payrollData } from "@/lib/finance/tools/queries";
import { findDownloadableFile } from "@/lib/files";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { getObject } from "@/lib/storage";
import { owner, admin, member, records } from "./fixtures";

export function registerPayrollPrivacyTests() {
  it("audits each record view and keeps salary, PAN, bank and private files out of ordinary exports and search", async () => {
    const before = await prisma.auditEvent.count({
      where: {
        workspaceId: owner.workspace.id,
        action: "finance.payroll_viewed",
      },
    });
    const data = await payrollData(admin, { month: "2026-06" });
    expect(data.runs).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          action: "finance.payroll_viewed",
        },
      }),
    ).toBe(before + data.profiles.length + data.runs.length);
    const exportData = await buildWorkspaceExport(owner.workspace.id);
    expect(
      (
        exportData as { entities: Record<string, Array<{ id?: string }>> }
      ).entities.LedgerEntry?.some((e) => e.id === data.runs[0]?.ledgerEntryId),
    ).toBe(false);
    expect(
      await prisma.searchDocument.count({
        where: {
          workspaceId: owner.workspace.id,
          entityId: { in: [records.payRunId, ...data.profiles.map((p) => p.id)] },
        },
      }),
    ).toBe(0);
    expect(
      (await financeReports(owner, { month: "2026-06" })).entries.some(
        (e) => e.privatePayroll,
      ),
    ).toBe(false);
  });
  it("stores generated payslips privately and checks grants on every download", async () => {
    const fileId = await generatePayslip(owner, records.payRunId);
    expect(await generatePayslip(owner, records.payRunId)).toBe(fileId);
    expect(await findDownloadableFile(fileId, member.user.id)).toBeNull();
    expect(await findDownloadableFile(fileId, admin.user.id)).not.toBeNull();
    const file = await prisma.fileObject.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: fileId },
    });
    expect(
      Buffer.from((await getObject(file.storageKey))!.body)
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    await grantPayroll(owner, { userId: admin.user.id, access: "NONE" });
    expect(await findDownloadableFile(fileId, admin.user.id)).toBeNull();
    await grantPayroll(owner, { userId: admin.user.id, access: "MANAGE" });
  }, 60000);
  it("permits payroll-only members with explicit grants and denies suspended grantees", async () => {
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { financeVisibleToMembers: false },
    });
    await grantPayroll(owner, { userId: member.user.id, access: "VIEW" });
    expect((await payrollData(member, { month: "2026-06" })).runs).toHaveLength(
      1,
    );
    await expect(
      savePayProfile(member, {
        name: "No",
        kind: "STAFF",
        rateMinor: 1,
        rateBasis: "MONTH",
        currency: "INR",
      }),
    ).rejects.toThrow("access");
    await expect(financeAccess(member)).rejects.toThrow("access");
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(payrollData(member, { month: "2026-06" })).rejects.toThrow(
      "access",
    );
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "ACTIVE" },
    });
  });
}
