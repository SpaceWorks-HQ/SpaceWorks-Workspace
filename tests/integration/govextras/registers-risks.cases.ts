import { it, expect } from "vitest";
import { saveRecord, loadGovernance, attachFile } from "@/lib/governance/service";
import { findDownloadableFile } from "@/lib/files";
import { owner, admin, handler, other, docId, entityId, proof } from "./fixtures";

export function registerRegistersRisksTests() {
  it("extends cover, licence and registration records with private evidence and calendar links", async () => {
    const obligation = (
      await saveRecord(owner, {
        kind: "OBLIGATION",
        title: "Renew office cover",
        status: "TODO",
        dueOn: "2027-01-10",
        details: { recurrence: "ANNUALLY" },
      })
    ).id;
    for (const kind of ["INSURANCE", "LICENCE", "REGISTRATION"] as const) {
      const row = await saveRecord(owner, {
        kind,
        title: kind,
        status: "ACTIVE",
        startsOn: "2026-01-01",
        endsOn: "2027-01-10",
        ownerId: owner.user.id,
        details: {
          issuer: "Community insurer",
          reference: "DEMO-123",
          scope: "Kochi office",
          currency: "INR",
          sumInsuredMinor: 10000000,
          premiumMinor: 125000,
          obligationId: obligation,
        },
      });
      const file = await attachFile(owner, row.id, proof());
      expect(await findDownloadableFile(file.id, admin.user.id)).not.toBeNull();
      expect(await findDownloadableFile(file.id, handler.user.id)).toBeNull();
      expect(
        (await loadGovernance(owner, "registers", {}, row.id)).selected?.kind,
      ).toBe(kind);
      await expect(
        saveRecord(other, {
          id: row.id,
          kind,
          title: "Foreign",
          status: "ACTIVE",
          startsOn: "2026-01-01",
          endsOn: "2027-01-01",
          details: { issuer: "X", reference: "X", currency: "INR" },
        }),
      ).rejects.toThrow();
    }
  });
  it("enforces tenant references for registers, emergency plans and reviews", async () => {
    await expect(
      saveRecord(other, {
        kind: "STATUTORY_REGISTER",
        title: "Members",
        status: "CURRENT",
        dueOn: "2027-01-01",
        details: { entityId, registerType: "MEMBERS" },
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord(other, {
        kind: "SOP_REVIEW",
        title: "Foreign SOP",
        status: "DUE",
        dueOn: "2027-01-01",
        details: { docId },
      }),
    ).rejects.toThrow();
    const row = await saveRecord(owner, {
      kind: "STATUTORY_REGISTER",
      title: "Trustee register snapshot",
      status: "CURRENT",
      dueOn: "2027-01-01",
      details: {
        entityId,
        registerType: "DIRECTORS",
        scope: "Trust deed register",
      },
    });
    await attachFile(owner, row.id, proof());
    expect(
      (await loadGovernance(owner, "registers", {}, row.id)).selected
        ?.attachments,
    ).toHaveLength(1);
  });
  it("records risks, emergency plan document links and completed drills", async () => {
    const risk = await saveRecord(owner, {
      kind: "RISK",
      title: "Blocked exit",
      status: "OPEN",
      dueOn: "2027-01-01",
      details: {
        likelihood: 3,
        impact: 5,
        controls: "Daily exit check",
        assessment: "Office occupants",
      },
    });
    const plan = await saveRecord(owner, {
      kind: "EMERGENCY_PLAN",
      title: "Evacuation",
      status: "ACTIVE",
      dueOn: "2027-01-01",
      details: { docId },
    });
    const drill = await saveRecord(owner, {
      kind: "DRILL",
      title: "October drill",
      status: "DONE",
      dueOn: "2026-10-01",
      details: {
        planId: plan.id,
        findings: "All exits clear",
        actions: "Refresh signage",
      },
    });
    expect(
      (await loadGovernance(owner, "risk", {}, risk.id)).selected?.details,
    ).toMatchObject({ likelihood: 3, impact: 5 });
    expect(
      (await loadGovernance(owner, "risk", {}, drill.id)).selected?.status,
    ).toBe("DONE");
  });
}
