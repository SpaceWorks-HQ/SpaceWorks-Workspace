import { describe, it, expect } from "vitest";
import { canManageRecurringCosts, canReadStaffAdvance } from "@/lib/roles";
import {
  dueInMonth,
  firstDue,
  nextDue,
  monthlyEquivalent,
  taxAmounts,
  instalmentAmounts,
  remittanceDate,
  csv,
  scheduleSchema,
} from "@/lib/finance/recurring/rules";
const day = (d: Date) => d.toISOString().slice(0, 10);
describe("recurring cost rules", () => {
  it.each(["OWNER", "ADMIN"] as const)("%s manages schedules", (role) =>
    expect(canManageRecurringCosts({ role })).toBe(true),
  );
  it.each(["MEMBER", "GUEST"] as const)("%s cannot manage schedules", (role) =>
    expect(canManageRecurringCosts({ role })).toBe(false),
  );
  it("only the person or explicit payroll managers read advances", () => {
    expect(canReadStaffAdvance({ role: "OWNER" }, null, "a", "b")).toBe(false);
    expect(canReadStaffAdvance({ role: "MEMBER" }, null, "b", "b")).toBe(true);
    expect(
      canReadStaffAdvance({ role: "MEMBER" }, { manage: false }, "a", "b"),
    ).toBe(false);
    expect(
      canReadStaffAdvance({ role: "MEMBER" }, { manage: true }, "a", "b"),
    ).toBe(true);
    expect(
      canReadStaffAdvance({ role: "GUEST" }, { manage: true }, "a", "a"),
    ).toBe(false);
  });
  it("clamps February including leap years", () => {
    expect(day(dueInMonth(2028, 1, 31))).toBe("2028-02-29");
    expect(day(dueInMonth(2027, 1, 31))).toBe("2027-02-28");
  });
  it("preserves the original due day after a short month", () =>
    expect(day(nextDue(new Date("2027-02-28"), "MONTHLY", 31))).toBe(
      "2027-03-31",
    ));
  it.each([
    ["MONTHLY", "2027-02-28"],
    ["QUARTERLY", "2027-04-30"],
    ["YEARLY", "2028-01-31"],
  ])("advances %s", (frequency, expected) =>
    expect(day(nextDue(new Date("2027-01-31"), frequency, 31))).toBe(expected),
  );
  it("starts on the first due date at or after start", () =>
    expect(day(firstDue(new Date("2026-10-21"), 1))).toBe("2026-11-01"));
  it("separates monthly equivalent and currency-independent minor amounts", () => {
    expect(monthlyEquivalent(180000, "YEARLY")).toBe(15000);
    expect(monthlyEquivalent(120000, "QUARTERLY")).toBe(40000);
  });
  it("calculates entered tax rates with minor-unit rounding", () =>
    expect(taxAmounts(4500000, 18, 10)).toEqual({
      gstMinor: 810000,
      tdsMinor: 450000,
      cashMinor: 4860000,
    }));
  it("rejects overflow and zero cash", () => {
    expect(() => taxAmounts(2147483647, 18, 0)).toThrow();
    expect(() => taxAmounts(100, 0, 100)).toThrow();
  });
  it("allocates every minor unit to an instalment", () =>
    expect(instalmentAmounts(2000001, 4)).toEqual([
      500001, 500000, 500000, 500000,
    ]));
  it.each([
    ["PF", "2027-01-15"],
    ["ESI", "2027-01-15"],
    ["SALARY_TDS", "2027-01-07"],
    ["PT", "2027-01-15"],
  ])("uses reviewed default for %s", (kind, expected) =>
    expect(day(remittanceDate("2026-12", kind))).toBe(expected),
  );
  it("allows state PT dates to be chosen", () =>
    expect(day(remittanceDate("2026-12", "PT", 31))).toBe("2027-01-31"));
  it("neutralises spreadsheet formulas and quotes lines", () =>
    expect(csv([["=1+1", 'a"b', "a\nb"]])).toBe('"\'=1+1","a""b","a\nb"'));
  it("validates schedule dates and money", () => {
    const value = {
      requestKey: "a",
      title: "Power",
      payee: "Utility",
      kind: "ELECTRICITY",
      amountMinor: 10000,
      currency: "INR",
      frequency: "MONTHLY",
      dueDay: 31,
      startsOn: "2026-02-30",
    };
    expect(scheduleSchema.safeParse(value).success).toBe(false);
    expect(
      scheduleSchema.safeParse({
        ...value,
        startsOn: "2026-02-28",
        endsOn: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      scheduleSchema.safeParse({ ...value, startsOn: "2026-02-28" }).success,
    ).toBe(true);
  });
});
