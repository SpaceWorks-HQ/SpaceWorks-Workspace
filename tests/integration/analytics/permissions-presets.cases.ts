import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { loadMetrics, drillRecords, listPresets } from "@/lib/analytics/queries";
import { savePreset } from "@/lib/analytics/service";
import { owner, member, guest, admin, outside, records, q, result } from "./fixtures";

export function registerPermissionsAndPresetsTests() {
  it("requires live permissions, not caller-supplied roles", async () => {
    await expect(loadMetrics(guest, q)).rejects.toThrow();
    expect(
      (
        await loadMetrics(
          { ...member, membership: { role: "OWNER" } },
          { ...q, section: "funding" },
        )
      ).metrics,
    ).toEqual([]);
    await expect(drillRecords(owner, "payroll", q)).rejects.toThrow();
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    expect((await result(owner, "payroll")).count).toBe(0);
    const profile = await prisma.financePayProfile.create({
      data: {
        workspaceId: owner.workspace.id,
        name: "Private salary fixture",
        kind: "STAFF",
        rateMinor: 5000,
      },
    });
    await prisma.financePayRun.create({
      data: {
        workspaceId: owner.workspace.id,
        profileId: profile.id,
        month: "2026-10",
        currency: "INR",
        grossMinor: 5000,
        netMinor: 4500,
        tdsMinor: 500,
        status: "PAID",
        paidOn: new Date("2026-10-10"),
        createdById: owner.user.id,
      },
    });
    await prisma.financeBill.create({
      data: {
        workspaceId: owner.workspace.id,
        vendor: "Private statutory fixture",
        number: "TDS-1",
        issuedOn: new Date("2026-10-10"),
        dueOn: new Date("2026-11-07"),
        amountMinor: 500,
        currency: "INR",
        privatePayroll: true,
        createdById: owner.user.id,
      },
    });
    expect((await result(owner, "payroll")).value).toBe(4500);
    expect((await result(owner, "payroll-gross")).value).toBe(5000);
    expect((await result(owner, "payroll-deductions")).value).toBe(500);
    expect((await result(owner, "remittances")).value).toBe(500);

    await prisma.financePayrollGrant.deleteMany({
      where: { workspaceId: owner.workspace.id },
    });
  });
  it("saves presets privately and shares only with current admins", async () => {
    records.presetId = await savePreset(owner, {
      name: "October management",
      query: { ...q, section: "home" },
      shared: true,
      pinned: true,
      commentary: "Office cash is stable.",
    });
    expect((await listPresets(admin)).map((r) => r.id)).toContain(records.presetId);
    expect((await listPresets(member)).map((r) => r.id)).not.toContain(
      records.presetId,
    );
    expect(await listPresets(outside)).toEqual([]);
    await expect(
      savePreset(member, {
        name: "Forged shared report",
        query: q,
        shared: true,
      }),
    ).rejects.toThrow();
    await expect(
      savePreset(outside, { id: records.presetId, name: "Foreign edit", query: q }),
    ).rejects.toThrow();
  });
}
