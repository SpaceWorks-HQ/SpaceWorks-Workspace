import { describe, expect, it } from "vitest";
import { canManageGovernance, canViewGovernance } from "@/lib/roles";
import {
  nextDate,
  csvCell,
  recordSchema,
  detailSchemas,
  dayInZone,
} from "@/lib/governance/schemas";
import { COMPLIANCE_TEMPLATES } from "@/lib/governance/templates";
const obligation = {
  kind: "OBLIGATION",
  title: "Annual filing",
  status: "TODO",
  dueOn: "2026-12-31",
  details: { recurrence: "ANNUALLY" },
};
describe("governance permissions and manual filing rules", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)(
    "gates %s consistently",
    (role) => {
      expect(canManageGovernance({ role })).toBe(
        ["OWNER", "ADMIN"].includes(role),
      );
      expect(canViewGovernance({ role })).toBe(canManageGovernance({ role }));
    },
  );
  it("denies missing membership", () =>
    expect(canManageGovernance(null)).toBe(false));
  it("requires real dates and correct statuses", () => {
    expect(recordSchema.safeParse(obligation).success).toBe(true);
    expect(
      recordSchema.safeParse({ ...obligation, dueOn: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      recordSchema.safeParse({ ...obligation, status: "APPROVED" }).success,
    ).toBe(false);
  });
  it("requires a meeting and committee for minutes", () =>
    expect(
      recordSchema.safeParse({
        kind: "MINUTES",
        title: "Minutes",
        status: "DRAFT",
        details: { content: "Agreed." },
      }).success,
    ).toBe(false));
  it("validates PAN and GSTIN while permitting international fallbacks", () => {
    expect(
      detailSchemas.VENDOR.safeParse({
        pan: "ABCDE1234F",
        gstin: "32ABCDE1234F1Z5",
      }).success,
    ).toBe(true);
    expect(detailSchemas.VENDOR.safeParse({ pan: "wrong" }).success).toBe(
      false,
    );
    expect(
      detailSchemas.VENDOR.safeParse({ overseasTaxId: "GB-123" }).success,
    ).toBe(true);
  });
  it("clamps month-end recurrence and leap years without losing history", () => {
    expect(nextDate("2024-02-29", "ANNUALLY")).toBe("2025-02-28");
    expect(nextDate("2026-01-31", "MONTHLY")).toBe("2026-02-28");
    expect(nextDate("2026-01-31", "QUARTERLY")).toBe("2026-04-30");
    expect(nextDate("2026-01-31", "NONE")).toBeNull();
  });
  it("rejects reversed terms and fractional money", () => {
    const contract = {
      kind: "CONTRACT",
      title: "Printing",
      status: "ACTIVE",
      startsOn: "2027-01-01",
      endsOn: "2026-12-31",
      details: {
        vendorId: "vendor",
        amountMinor: 100,
        currency: "INR",
        noticeDays: 30,
      },
    };
    expect(recordSchema.safeParse(contract).success).toBe(false);
    expect(
      detailSchemas.CONTRACT.safeParse({
        ...contract.details,
        amountMinor: 10.5,
      }).success,
    ).toBe(false);
  });
  it("neutralises spreadsheet formulas and quotes multiline CSV", () => {
    expect(csvCell(' =HYPERLINK("bad")')).toBe('"\' =HYPERLINK(""bad"")"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("uses workspace calendar days", () =>
    expect(dayInZone(new Date("2026-10-20T20:00:00Z"), "Asia/Kolkata")).toBe(
      "2026-10-21",
    ));
  it("offers all requested templates without inferred deadlines", () => {
    expect(COMPLIANCE_TEMPLATES).toHaveLength(14);
    expect(
      COMPLIANCE_TEMPLATES.every((t) => t.applies && !("dueOn" in t)),
    ).toBe(true);
  });
});
