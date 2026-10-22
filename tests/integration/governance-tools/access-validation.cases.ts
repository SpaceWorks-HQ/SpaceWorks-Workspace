import { expect, it } from "vitest";
import { saveRecord, loadGovernance } from "@/lib/governance/service";
import {
  actor,
  other,
  member,
  guest,
  committeeId,
  organisationId,
  meetingId,
  obligation,
} from "./fixtures";

export function registerAccessValidationTests() {
  it("denies members, guests, forged roles and cross-workspace edits", async () => {
    for (const denied of [
      member,
      guest,
      { ...member, membership: { role: "OWNER" as const } },
    ]) {
      await expect(saveRecord(denied, obligation())).rejects.toThrow();
      await expect(loadGovernance(denied, "board", {})).rejects.toThrow();
    }
    await expect(
      saveRecord(other, {
        kind: "COMMITTEE",
        id: committeeId,
        title: "Changed",
        status: "ACTIVE",
        details: { committeeType: "BOARD" },
      }),
    ).rejects.toThrow();
    expect(
      (await loadGovernance(other, "board", {}, committeeId)).selected,
    ).toBeNull();
  });
  it("validates references to committee, meeting, owner, vendor and CRM organisation", async () => {
    await expect(
      saveRecord(other, {
        kind: "MINUTES",
        title: "Minutes",
        status: "DRAFT",
        parentId: committeeId,
        meetingId,
        details: { content: "Agreed." },
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord(other, {
        kind: "VENDOR",
        title: "Vendor",
        status: "ACTIVE",
        organisationId,
        details: {},
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord(actor, obligation({ ownerId: other.user.id })),
    ).rejects.toThrow();
    await expect(
      saveRecord(actor, {
        kind: "CONTRACT",
        title: "Contract",
        status: "ACTIVE",
        startsOn: "2026-01-01",
        endsOn: "2027-01-01",
        details: {
          vendorId: committeeId,
          amountMinor: 10000,
          currency: "INR",
          noticeDays: 30,
        },
      }),
    ).rejects.toThrow();
  });
}
