import { describe, expect, it } from "vitest";
import { canManageMoneyControls, canReadMoneyControl } from "@/lib/roles";
import {
  countDenominations,
  csv,
  dateSchema,
  depreciation,
  detailsSchemas,
  fiscalQuarter,
  fiscalYear,
  fundIssues,
  type FundCharge,
} from "@/lib/moneyControls/rules";
const basis = {
  method: "SLM" as const,
  lifeYears: 5,
  rateBps: 2000,
  residualMinor: 0,
};
describe("money controls pure rules", () => {
  it.each(["OWNER", "ADMIN"] as const)("%s manages controls", (role) =>
    expect(canManageMoneyControls({ role })).toBe(true),
  );
  it.each(["MEMBER", "GUEST"] as const)("%s cannot manage controls", (role) =>
    expect(canManageMoneyControls({ role })).toBe(false),
  );
  it("allows only a handover's participants and managers", () => {
    const r = {
      kind: "HANDOVER",
      ownerId: "incoming",
      createdById: "admin",
      details: { outgoingId: "outgoing" },
    };
    expect(canReadMoneyControl({ role: "MEMBER" }, "incoming", r)).toBe(true);
    expect(canReadMoneyControl({ role: "MEMBER" }, "outgoing", r)).toBe(true);
    expect(canReadMoneyControl({ role: "MEMBER" }, "other", r)).toBe(false);
    expect(canReadMoneyControl({ role: "GUEST" }, "incoming", r)).toBe(false);
    expect(
      canReadMoneyControl({ role: "MEMBER" }, "incoming", {
        ...r,
        kind: "DEPOSIT",
      }),
    ).toBe(false);
  });
  it("counts Indian notes and coins with integer minor units", () =>
    expect(countDenominations("500=2,100=3\n0.50=4", "INR")).toBe(130200));
  it.each([
    "500=2,500=1",
    "500=-1",
    "NaN=4",
    "0=10",
    "",
    "500=9999999999999999",
  ])("rejects invalid denominations: %s", (s) =>
    expect(() => countDenominations(s, "INR")).toThrow(),
  );
  it("uses the account currency precision", () => {
    expect(countDenominations("100=3", "JPY")).toBe(300);
    expect(countDenominations("0.005=2", "KWD")).toBe(10);
  });
  it("tracks financial-year boundaries and quarters", () => {
    expect(fiscalYear("2026-03-31")).toBe(2025);
    expect(fiscalYear("2026-04-01")).toBe(2026);
    expect(fiscalQuarter("2026-04-01")).toBe("Q1");
    expect(fiscalQuarter("2027-01-01")).toBe("Q4");
  });
  it("rejects impossible calendar dates", () => {
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateSchema.safeParse("2028-02-29").success).toBe(true);
  });
  it("computes SLM without depreciating below residual value", () => {
    expect(depreciation(100000, "2026-04-01", basis, 2026)).toEqual({
      openingMinor: 100000,
      depreciationMinor: 20000,
      disposalMinor: 0,
      closingMinor: 80000,
    });
    expect(
      depreciation(
        100000,
        "2026-04-01",
        { ...basis, residualMinor: 10000 },
        2040,
      ).closingMinor,
    ).toBe(10000);
  });
  it("computes WDV from each year's opening value", () =>
    expect(
      depreciation(100000, "2026-04-01", { ...basis, method: "WDV" }, 2027),
    ).toEqual({
      openingMinor: 80000,
      depreciationMinor: 16000,
      disposalMinor: 0,
      closingMinor: 64000,
    }));
  it("prorates additions and stops on the disposal date", () => {
    expect(
      depreciation(36500, "2026-10-01", { ...basis, lifeYears: 1 }, 2026)
        .depreciationMinor,
    ).toBe(18200);
    expect(
      depreciation(
        36500,
        "2026-04-01",
        { ...basis, lifeYears: 1 },
        2026,
        "2026-04-11",
      ).depreciationMinor,
    ).toBe(1000);
    expect(
      depreciation(36500, "2026-04-01", basis, 2027, "2026-04-11").closingMinor,
    ).toBe(0);
  });
  it("has no value in years before purchase", () =>
    expect(depreciation(100, "2026-04-01", basis, 2025)).toEqual({
      openingMinor: 0,
      depreciationMinor: 0,
      disposalMinor: 0,
      closingMinor: 0,
    }));
  it("accepts manual form names and international withholding codes", () =>
    expect(
      detailsSchemas.FILING.safeParse({
        fiscalYear: 2026,
        quarter: "Q1",
        form: "Local withholding return",
      }).success,
    ).toBe(true));
  it("separates eligibility, budget and duplicate enforcement", () => {
    const charge: FundCharge = {
      sourceType: "entry",
      sourceId: "x",
      fundId: "fund",
      amountMinor: 100,
      currency: "INR",
      categoryId: "bad",
      occurredOn: new Date("2027-04-01"),
      duplicateKey: "invoice",
      payroll: false,
    };
    const rule = {
      fundId: "fund",
      amountMinor: 100,
      currency: "INR",
      occurredOn: new Date("2026-04-01"),
      endsOn: new Date("2027-03-31"),
      details: {
        allowedCategoryIds: ["good"],
        eligibilityMode: "BLOCK" as const,
        budgetMode: "WARN" as const,
        duplicateMode: "BLOCK" as const,
      },
    };
    expect(fundIssues(charge, rule, 101, true).map((i) => i.mode)).toEqual([
      "BLOCK",
      "WARN",
      "BLOCK",
    ]);
  });
  it("quotes exports and neutralises spreadsheet formulas", () => {
    const out = csv([["=SUM(A1)", "a,b", "a\nb", 'a"b']]);
    expect(out).toContain('"\'=SUM(A1)"');
    expect(out).toContain('"a""b"');
  });
});
