import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { controlRecord } from "@/lib/moneyControls/access";
import { grantPayroll } from "@/lib/finance/tools/payroll";
import { findDownloadableFile } from "@/lib/files";
import { actor, admin, save, transition, attach } from "./fixtures";

export function registerCertificatesTests() {
  it("matches official certificates and retains filing acceptance history", async () => {
    const details = {
      payee: "Office landlord",
      section: "194-I",
      fiscalYear: 2026,
      quarter: "Q1",
      grossMinor: 100000,
    };
    const deduction = await save("TDS_DEDUCTION", {
      amountMinor: 10000,
      details,
    });
    await transition(deduction);
    await expect(
      save("CERTIFICATE", {
        parentId: deduction,
        amountMinor: 10000,
        details: {
          ...details,
          payee: "Wrong payee",
          direction: "ISSUED",
          form: "16A",
          certificateNumber: "MC-1",
        },
      }),
    ).rejects.toThrow(/Match/);
    const cert = await save("CERTIFICATE", {
      parentId: deduction,
      amountMinor: 10000,
      details: {
        ...details,
        direction: "ISSUED",
        form: "16A",
        certificateNumber: "MC-1",
      },
    });
    await expect(transition(cert)).rejects.toThrow(/PDF/);
    await attach(cert);
    await transition(cert);
    const filing = await save("FILING", {
      amountMinor: 10000,
      details: {
        fiscalYear: 2026,
        quarter: "Q1",
        form: "Quarterly withholding return",
      },
    });
    await transition(filing);
    await expect(transition(filing, "ACCEPTED")).rejects.toThrow(/order/);
    await attach(filing);
    for (const op of ["SUBMITTED", "ACCEPTED", "PAID"])
      await transition(filing, op, { reference: `${op}-ACK` });
    const history = await prisma.moneyControlEvent.findMany({
      where: {
        workspaceId: actor.workspace.id,
        recordId: filing,
        action: { in: ["SUBMITTED", "ACCEPTED", "PAID"] },
      },
    });
    expect(history).toHaveLength(3);
    expect((await controlRecord(actor, filing)).status).toBe("PAID");
  });
  it("requires explicit payroll access for salary certificates and revokes downloads", async () => {
    await expect(
      save("CERTIFICATE", {
        details: {
          payee: "Staff",
          fiscalYear: 2026,
          quarter: "ANNUAL",
          direction: "ISSUED",
          form: "16",
          certificateNumber: "Salary-1",
        },
      }),
    ).rejects.toThrow(/payroll grant/);
    await grantPayroll(actor, { userId: actor.user.id, access: "MANAGE" });
    const id = await save("CERTIFICATE", {
        details: {
          payee: "Staff",
          fiscalYear: 2026,
          quarter: "ANNUAL",
          direction: "ISSUED",
          form: "16",
          certificateNumber: "Salary-1",
        },
      }),
      f = await attach(id);
    expect(
      await prisma.searchDocument.count({
        where: {
          workspaceId: actor.workspace.id,
          entityType: "money_control",
          entityId: id,
        },
      }),
    ).toBe(0);
    expect(await findDownloadableFile(f.id, admin.user.id)).toBeNull();
    await grantPayroll(actor, { userId: actor.user.id, access: "NONE" });
    expect(await findDownloadableFile(f.id, actor.user.id)).toBeNull();
  });
}
