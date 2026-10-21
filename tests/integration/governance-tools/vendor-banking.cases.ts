import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, loadGovernance, changeBank, revealBank } from "@/lib/governance/service";
import { actor, other, member, organisationId, records } from "./fixtures";

export function registerVendorBankingTests() {
  it("extends an existing CRM organisation and encrypts every banking revision", async () => {
    records.vendorId = (
      await saveRecord(actor, {
        kind: "VENDOR",
        title: "Print vendor",
        status: "ACTIVE",
        organisationId,
        details: { pan: "ABCDE1234F", gstin: "32ABCDE1234F1Z5" },
      })
    ).id;
    await changeBank(actor, {
      vendorId: records.vendorId,
      accountName: "Print cooperative",
      bankName: "Community bank",
      accountNumber: "0123456789",
      routingCode: "TEST0000001",
      reason: "Initial verified bank instructions",
    });
    await changeBank(actor, {
      vendorId: records.vendorId,
      accountName: "Print cooperative",
      bankName: "Community bank",
      accountNumber: "9876543210",
      reason: "Verified replacement account",
    });
    const changes = await prisma.governanceBankChange.findMany({
      where: { workspaceId: actor.workspace.id, vendorId: records.vendorId },
    });
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => !c.bankEnc.includes("9876543210"))).toBe(true);
    expect((await revealBank(actor, records.vendorId))?.accountNumber).toBe(
      "9876543210",
    );
    await expect(revealBank(member, records.vendorId)).rejects.toThrow();
    await expect(revealBank(other, records.vendorId)).rejects.toThrow();
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: actor.workspace.id,
          targetId: records.vendorId,
          action: "governance.bank_revealed",
        },
      }),
    ).toBe(1);
    const selected = (await loadGovernance(actor, "vendors", {}, records.vendorId))
      .selected!;
    expect(JSON.stringify(selected)).not.toContain("bankEnc");
    expect(JSON.stringify(selected)).not.toContain("9876543210");
  });
}
