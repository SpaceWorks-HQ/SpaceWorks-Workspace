import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format/money";
import {
  invoiceTotals,
  ledgerTotals,
  lineSubtotalMinor,
  lineTaxMinor,
  minorToDecimalString,
  parsePercentToBps,
  runningBalances,
  signedAmount,
} from "@/lib/finance/money";
import { canTransition, formatInvoiceNumber, isEditableInvoice, isInvoiceOverdue } from "@/lib/finance/invoice";
import { localDate, monthKeys } from "@/lib/finance/dates";
import { ledgerFiltersToQuery, parseLedgerFilters } from "@/lib/finance/filters";

describe("ledger math", () => {
  const entries = [
    { kind: "INCOME" as const, amountMinor: 1_200_000 },
    { kind: "EXPENSE" as const, amountMinor: 800_000 },
    { kind: "EXPENSE" as const, amountMinor: 50_000, voidedAt: new Date() },
    { kind: "EXPENSE" as const, amountMinor: 184_550 },
  ];

  it("signs income and expenses", () => {
    expect(signedAmount("INCOME", 500)).toBe(500);
    expect(signedAmount("EXPENSE", 500)).toBe(-500);
  });

  it("totals skip voided entries", () => {
    expect(ledgerTotals(entries)).toEqual({ incomeMinor: 1_200_000, expenseMinor: 984_550, netMinor: 215_450, count: 3 });
  });

  it("carries a running balance and leaves it unchanged on voided rows", () => {
    expect(runningBalances(entries)).toEqual([1_200_000, 400_000, 400_000, 215_450]);
    expect(runningBalances(entries, 10_000)).toEqual([1_210_000, 410_000, 410_000, 225_450]);
  });

  it("formats the kitty in the workspace currency with Intl", () => {
    expect(formatMoney(215_450, "INR")).toBe("₹2,154.50");
    expect(formatMoney(-215_450, "INR")).toBe("-₹2,154.50");
    expect(formatMoney(1500, "JPY", { locale: "en-US" })).toBe("¥1,500");
  });

  it("writes plain decimals for inputs and CSV", () => {
    expect(minorToDecimalString(125_050, "INR")).toBe("1250.50");
    expect(minorToDecimalString(5, "INR")).toBe("0.05");
    expect(minorToDecimalString(-125_000, "INR")).toBe("-1250.00");
    expect(minorToDecimalString(1500, "JPY")).toBe("1500");
  });
});

describe("invoice totals", () => {
  it("multiplies quantity by unit price in whole minor units", () => {
    expect(lineSubtotalMinor({ quantity: 3, unitMinor: 25_000 })).toBe(75_000);
    expect(lineSubtotalMinor({ quantity: 1.5, unitMinor: 33_333 })).toBe(50_000); // 49,999.5 rounds half away
    expect(lineSubtotalMinor({ quantity: 0.1, unitMinor: 3 })).toBe(0);
    // Floating quantities never drift (0.1 + 0.2 style).
    expect(lineSubtotalMinor({ quantity: 2.3, unitMinor: 100 })).toBe(230);
  });

  it("adds optional per-line tax", () => {
    expect(lineTaxMinor({ description: "Laser time", quantity: 2, unitMinor: 50_000, taxBps: 1800 })).toBe(18_000);
    expect(lineTaxMinor({ description: "No tax", quantity: 2, unitMinor: 50_000 })).toBe(0);
    expect(
      invoiceTotals([
        { description: "Workshop seats", quantity: 10, unitMinor: 75_000 },
        { description: "Laser time", quantity: 2, unitMinor: 50_000, taxBps: 1800 },
      ]),
    ).toEqual({ subtotalMinor: 850_000, taxMinor: 18_000, totalMinor: 868_000 });
    expect(invoiceTotals([])).toEqual({ subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
  });

  it("parses tax percentages into basis points", () => {
    expect(parsePercentToBps("18")).toBe(1800);
    expect(parsePercentToBps("12.5%")).toBe(1250);
    expect(parsePercentToBps("")).toBe(0);
    expect(parsePercentToBps("101")).toBeNull();
    expect(parsePercentToBps("abc")).toBeNull();
    expect(parsePercentToBps("1.234")).toBeNull();
  });
});

describe("invoice rules", () => {
  it("numbers invoices from the workspace counter", () => {
    expect(formatInvoiceNumber(7)).toBe("INV-0007");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
  });

  it("follows DRAFT → SENT → PAID / VOID", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("DRAFT", "PAID")).toBe(false);
    expect(canTransition("SENT", "PAID")).toBe(true);
    expect(canTransition("SENT", "VOID")).toBe(true);
    expect(canTransition("PAID", "VOID")).toBe(true);
    expect(canTransition("PAID", "SENT")).toBe(false);
    expect(canTransition("VOID", "DRAFT")).toBe(false);
    expect(isEditableInvoice("SENT")).toBe(true);
    expect(isEditableInvoice("PAID")).toBe(false);
  });

  it("is overdue only when sent and past its due date", () => {
    const due = new Date("2026-10-10T00:00:00Z");
    expect(isInvoiceOverdue({ status: "SENT", dueOn: due }, "2026-10-11")).toBe(true);
    expect(isInvoiceOverdue({ status: "SENT", dueOn: due }, "2026-10-10")).toBe(false);
    expect(isInvoiceOverdue({ status: "PAID", dueOn: due }, "2026-11-01")).toBe(false);
    expect(isInvoiceOverdue({ status: "SENT", dueOn: null }, "2026-11-01")).toBe(false);
  });

  it("reads the local date in the workspace time zone", () => {
    const now = new Date("2026-10-18T20:00:00Z");
    expect(localDate(now, "Asia/Kolkata")).toBe("2026-10-19");
    expect(localDate(now, "UTC")).toBe("2026-10-18");
  });
});

describe("ledger filters", () => {
  it("parses and normalises search params", () => {
    expect(parseLedgerFilters({ kind: "expense", from: "2026-10-31", to: "2026-10-01", q: " rent ", page: "2", voided: "1" })).toEqual({
      kind: "EXPENSE",
      categoryId: null,
      from: "2026-10-01",
      to: "2026-10-31",
      q: "rent",
      includeVoided: true,
      page: 2,
    });
    expect(parseLedgerFilters({ kind: "both", from: "2026-02-30", page: "-3", category: "../x" })).toMatchObject({ kind: null, from: null, page: 1, categoryId: null });
  });

  it("round-trips to a query string", () => {
    expect(ledgerFiltersToQuery({ kind: "INCOME", q: "rent & food", page: 1 })).toBe("?kind=income&q=rent+%26+food");
    expect(ledgerFiltersToQuery({})).toBe("");
  });

  it("lists the last twelve calendar months", () => {
    const keys = monthKeys("2026-02-14", 12);
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2025-03");
    expect(keys[11]).toBe("2026-02");
  });
});
