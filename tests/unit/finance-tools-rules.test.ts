import { describe, it, expect } from "vitest";
import {
  billStatus,
  monthPeriod,
  moneyInput,
  normalizeVendor,
  payTotals,
  possibleDuplicates,
  toolSchemas,
} from "@/lib/finance/tools-rules";
import { canManagePayroll, canViewPayroll } from "@/lib/roles";

describe("manual finance calculations", () => {
  it("uses leap years and calendar month ends", () => {
    expect(monthPeriod("2028-02")).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
    expect(monthPeriod("2026-12").end).toBe("2026-12-31");
    expect(() => monthPeriod("2026-13")).toThrow();
  });
  it("subtracts every deduction without assuming tax rates", () => {
    expect(
      payTotals({
        grossMinor: 100000,
        allowancesMinor: 5000,
        pfMinor: 1000,
        esiMinor: 200,
        ptMinor: 100,
        tdsMinor: 3000,
        advancesMinor: 10000,
        otherMinor: 700,
      }),
    ).toEqual({
      earningsMinor: 105000,
      deductionsMinor: 15000,
      netMinor: 90000,
    });
  });
  it("rejects deductions beyond earnings and integer overflow", () => {
    expect(() =>
      payTotals({
        grossMinor: 100,
        allowancesMinor: 0,
        pfMinor: 101,
        esiMinor: 0,
        ptMinor: 0,
        tdsMinor: 0,
        advancesMinor: 0,
        otherMinor: 0,
      }),
    ).toThrow("Deductions");
    expect(() =>
      payTotals({
        grossMinor: 2147483647,
        allowancesMinor: 1,
        pfMinor: 0,
        esiMinor: 0,
        ptMinor: 0,
        tdsMinor: 0,
        advancesMinor: 0,
        otherMinor: 0,
      }),
    ).toThrow();
  });
  it("parses currency precision and permits negative statement balances", () => {
    expect(moneyInput("1,234.50", "INR")).toBe(123450);
    expect(moneyInput("-20.50", "INR", true)).toBe(-2050);
    expect(moneyInput("25", "JPY")).toBe(25);
    expect(() => moneyInput("-1", "INR")).toThrow();
    expect(() => moneyInput("0.001", "INR")).toThrow();
    expect(() => moneyInput("21474836.48", "INR")).toThrow();
  });
  it.each([
    [100, 0, "Unpaid"],
    [100, 40, "Partly paid"],
    [100, 100, "Paid"],
  ])("classifies a %s bill with %s paid", (total, paid, status) => {
    expect(billStatus(Number(total), Number(paid))).toBe(status);
  });
});
describe("spending review", () => {
  const entry = (
    id: string,
    date: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    occurredOn: date,
    counterparty: "Kochi Supplies",
    amountMinor: 120000,
    currency: "INR",
    invoiceNumber: null,
    ...extra,
  });
  it("normalises punctuation and case in vendors", () => {
    expect(normalizeVendor("  KOCHI Supplies, Pvt. ")).toBe("kochisuppliespvt");
  });
  it("flags matching vendor and amount inside seven days including the boundary", () => {
    expect(
      possibleDuplicates([
        entry("a", "2026-10-01"),
        entry("b", "2026-10-08"),
        entry("c", "2026-10-16"),
      ]),
    ).toEqual([["a", "b"]]);
  });
  it("compares matching invoice numbers even outside a week", () => {
    expect(
      possibleDuplicates([
        entry("a", "2026-01-01", { invoiceNumber: "INV-12" }),
        entry("b", "2026-10-19", {
          invoiceNumber: "inv 12",
          amountMinor: 2000,
        }),
      ]),
    ).toEqual([["a", "b"]]);
  });
  it("does not match anonymous vendors or amounts in different currencies", () => {
    expect(
      possibleDuplicates([
        entry("a", "2026-10-01", { counterparty: null }),
        entry("b", "2026-10-01", { counterparty: null }),
        entry("c", "2026-10-01", { currency: "USD" }),
        entry("d", "2026-10-01"),
      ]),
    ).toEqual([]);
  });
  it("returns a pair once when both duplicate signals match", () => {
    expect(
      possibleDuplicates([
        entry("a", "2026-10-01", { invoiceNumber: "x" }),
        entry("b", "2026-10-02", { invoiceNumber: "x" }),
      ]),
    ).toHaveLength(1);
  });
});
describe("payroll capabilities and safe manual inputs", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)(
    "does not grant %s payroll by role",
    (role) => {
      expect(canViewPayroll({ role }, null)).toBe(false);
      expect(canManagePayroll({ role }, null)).toBe(false);
    },
  );
  it("distinguishes explicit view and management grants", () => {
    expect(canViewPayroll({ role: "MEMBER" }, { manage: false })).toBe(true);
    expect(canManagePayroll({ role: "ADMIN" }, { manage: false })).toBe(false);
    expect(canManagePayroll({ role: "MEMBER" }, { manage: true })).toBe(true);
    expect(canViewPayroll({ role: "GUEST" }, { manage: true })).toBe(false);
  });
  it("allows only four bank digits and validates PAN/IFSC", () => {
    const base = {
      name: "Asha",
      kind: "STAFF",
      currency: "INR",
      rateMinor: 100,
      rateBasis: "MONTH",
    };
    expect(
      toolSchemas.payProfile.safeParse({ ...base, bankLast4: "12345678" })
        .success,
    ).toBe(false);
    expect(
      toolSchemas.payProfile.safeParse({
        ...base,
        pan: "XXXXX1234X",
        bankLast4: "1234",
        ifsc: "SBIN0001234",
      }).success,
    ).toBe(true);
  });
  it("rejects unsafe event URLs and invalid bill dates", () => {
    expect(
      toolSchemas.centre.safeParse({
        name: "Repair day",
        kind: "EVENT",
        externalUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      toolSchemas.bill.safeParse({
        vendor: "Vendor",
        number: "1",
        issuedOn: "2026-10-05",
        dueOn: "2026-10-01",
        currency: "INR",
        amountMinor: 100,
      }).success,
    ).toBe(false);
  });
});
