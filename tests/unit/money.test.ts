import { describe, expect, it } from "vitest";
import { currencyMinorDigits, formatMoney, formatMoneyCompact, isValidCurrency, parseMoneyToMinor } from "@/lib/format/money";

describe("money formatting", () => {
  it("formats INR minor units with Indian grouping", () => {
    expect(formatMoney(12_345_678, "INR")).toBe("₹1,23,456.78");
    expect(formatMoney(0, "INR")).toBe("₹0.00");
    expect(formatMoney(-5000, "INR")).toBe("-₹50.00");
  });

  it("respects currencies without minor units", () => {
    expect(currencyMinorDigits("JPY")).toBe(0);
    expect(formatMoney(1500, "JPY", { locale: "en-US" })).toBe("¥1,500");
    expect(currencyMinorDigits("INR")).toBe(2);
  });

  it("formats compact values for stat cards", () => {
    expect(formatMoneyCompact(15_000_000, "INR")).toMatch(/^₹1\.5L$/);
  });

  it("validates currency codes", () => {
    expect(isValidCurrency("INR")).toBe(true);
    expect(isValidCurrency("inr")).toBe(false);
    expect(isValidCurrency("ZZZZ")).toBe(false);
  });

  it("parses typed amounts into minor units", () => {
    expect(parseMoneyToMinor("1,250.5", "INR")).toBe(125_050);
    expect(parseMoneyToMinor("₹ 99", "INR")).toBe(9900);
    expect(parseMoneyToMinor("10.123", "INR")).toBeNull();
    expect(parseMoneyToMinor("abc", "INR")).toBeNull();
    expect(parseMoneyToMinor("500", "JPY")).toBe(500);
    expect(parseMoneyToMinor("5.5", "JPY")).toBeNull();
  });
});
