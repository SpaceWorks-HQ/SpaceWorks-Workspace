import { describe, it, expect } from "vitest";
import {
  riskScore,
  partyMatches,
  caseSchema,
  eventSchema,
} from "@/lib/govextras/rules";
import {
  canHandleSafeguarding,
  canManageSafeguardingHandlers,
} from "@/lib/roles";
import { recordSchema, detailSchemas } from "@/lib/governance/schemas";
import { isReservedFolder } from "@/lib/files/versions";
import { bundleZip } from "@/lib/govextras/bundle";

describe("governance extras rules", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)(
    "requires explicit appointment and assignment for %s",
    (role) => {
      expect(canManageSafeguardingHandlers({ role })).toBe(role === "OWNER");
      expect(canHandleSafeguarding({ role }, true, true)).toBe(
        role !== "GUEST",
      );
      expect(canHandleSafeguarding({ role }, false, true)).toBe(false);
      expect(canHandleSafeguarding({ role }, true, false)).toBe(false);
    },
  );
  it("scores likelihood by impact and validates scale", () => {
    expect(riskScore(5, 5)).toEqual({ score: 25, level: "High" });
    expect(riskScore(2, 3)).toEqual({ score: 6, level: "Medium" });
    expect(riskScore(1, 1)).toEqual({ score: 1, level: "Low" });
    expect(() => riskScore(0, 3)).toThrow();
    expect(() => riskScore(2.5, 3)).toThrow();
  });
  it("matches exact normalised payees without guessing aliases", () => {
    expect(partyMatches(" Kochi   PRINT ", "kochi print")).toBe(true);
    expect(partyMatches("Kochi print", "Kochi printers")).toBe(false);
    expect(partyMatches("", "")).toBe(false);
  });
  it("requires case handlers and a due date after receipt", () => {
    const input = {
      kind: "POSH",
      receivedOn: "2026-10-01",
      dueOn: "2026-10-03",
      handlerIds: ["a"],
      details: "Restricted concern",
    };
    expect(caseSchema.safeParse(input).success).toBe(true);
    expect(
      caseSchema.safeParse({ ...input, dueOn: "2026-09-01" }).success,
    ).toBe(false);
    expect(caseSchema.safeParse({ ...input, handlerIds: [] }).success).toBe(
      false,
    );
    expect(
      caseSchema.safeParse({ ...input, receivedOn: "2026-02-30" }).success,
    ).toBe(false);
  });
  it("requires an action owner and due date while allowing simple notes", () => {
    expect(
      eventSchema.safeParse({ caseId: "a", kind: "NOTE", body: "Note" })
        .success,
    ).toBe(true);
    expect(
      eventSchema.safeParse({ caseId: "a", kind: "ACTION", body: "Action" })
        .success,
    ).toBe(false);
  });
  it.each(["INSURANCE", "LICENCE", "REGISTRATION"] as const)(
    "validates %s dates and integer money",
    (kind) => {
      const input = {
        kind,
        title: "Office cover",
        status: "ACTIVE",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        details: {
          issuer: "Issuer",
          reference: "Ref",
          currency: "INR",
          premiumMinor: 125050,
        },
      };
      expect(recordSchema.safeParse(input).success).toBe(true);
      expect(
        recordSchema.safeParse({ ...input, endsOn: "2025-12-31" }).success,
      ).toBe(false);
      expect(
        recordSchema.safeParse({
          ...input,
          details: { ...input.details, premiumMinor: 12.5 },
        }).success,
      ).toBe(false);
    },
  );
  it("requires documents and entity register references", () => {
    expect(detailSchemas.SOP_REVIEW.safeParse({ docId: "" }).success).toBe(
      false,
    );
    expect(
      detailSchemas.STATUTORY_REGISTER.safeParse({ registerType: "MEMBERS" })
        .success,
    ).toBe(false);
    expect(
      detailSchemas.BOARD_PACK.safeParse({
        docIds: ["a"],
        includeFinance: true,
        currency: "INR",
      }).success,
    ).toBe(true);
  });
  it("reserves both private evidence folders from library moves", () => {
    for (const f of [
      "/safeguarding",
      "/safeguarding/cases",
      "/governance",
      "/governance/packs",
    ])
      expect(isReservedFolder(f)).toBe(true);
    expect(isReservedFolder("/team")).toBe(false);
  });
  it("writes a complete ZIP central directory for multiple UTF-8 entries", () => {
    const bytes = bundleZip([
      { name: "manifest.json", body: Buffer.from('{"a":1}') },
      { name: "evidence/proof.pdf", body: Buffer.from("%PDF-test") },
    ]);
    expect(bytes.readUInt32LE()).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
    expect(bytes.readUInt16LE(end + 10)).toBe(2);
    const central = bytes.readUInt32LE(end + 16);
    expect(bytes.readUInt32LE(central)).toBe(0x02014b50);
    expect(bytes.includes(Buffer.from("evidence/proof.pdf"))).toBe(true);
  });
});
