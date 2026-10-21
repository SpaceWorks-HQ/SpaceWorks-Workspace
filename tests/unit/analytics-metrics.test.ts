import { describe, it, expect } from "vitest";
import {
  periodFor,
  comparisons,
  addMonths,
  ageingBucket,
  donorRetention,
  monthlyBurn,
  forecastBuckets,
  forecastBucketPeriod,
  sla,
  mttr,
  winRate,
  rate,
  average,
  delta,
  csv,
  querySchema,
  safeNumber,
  displayValue,
  parseCashAmount,
} from "@/lib/analytics/metrics";
import { canViewAnalytics, canManageAnalytics } from "@/lib/roles";
const p = (period: string, today: string) => periodFor({ period }, today);
describe("analytics period and financial year arithmetic", () => {
  it.each([
    ["2026-03-31", "2025-04-01"],
    ["2026-04-01", "2026-04-01"],
    ["2027-01-15", "2026-04-01"],
  ])("starts the April FY for %s", (date, start) =>
    expect(p("fy", date)).toEqual({ from: start, to: date }),
  );
  it("compares equal day counts and clamps leap years", () => {
    expect(comparisons({ from: "2024-02-01", to: "2024-02-29" })).toEqual({
      previous: { from: "2024-01-03", to: "2024-01-31" },
      lastYear: { from: "2023-02-01", to: "2023-02-28" },
    });
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("handles quarter, year and month boundaries", () => {
    expect(p("last-month", "2026-01-01")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(p("quarter", "2026-10-21").from).toBe("2026-10-01");
    expect(p("month", "2026-02-03")).toEqual({
      from: "2026-02-01",
      to: "2026-02-03",
    });
  });
  it("rejects invalid and unbounded custom periods", () => {
    expect(() =>
      periodFor(
        { period: "custom", from: "2026-02-30", to: "2026-03-01" },
        "2026-10-21",
      ),
    ).toThrow();
    expect(() =>
      periodFor(
        { period: "custom", from: "2026-10-22", to: "2026-10-21" },
        "2026-10-21",
      ),
    ).toThrow();
    expect(() =>
      periodFor(
        { period: "custom", from: "2020-01-01", to: "2026-01-01" },
        "2026-10-21",
      ),
    ).toThrow();
  });
});
describe("analytics arithmetic contracts", () => {
  it.each([
    [0, "0–30"],
    [30, "0–30"],
    [31, "31–60"],
    [60, "31–60"],
    [61, "61–90"],
    [90, "61–90"],
    [91, "90+"],
  ])("keeps ageing day %s in %s", (n, bucket) =>
    expect(
      ageingBucket(
        "2026-01-01",
        new Date(Date.parse("2026-01-01") + Number(n) * 86400000)
          .toISOString()
          .slice(0, 10),
      ),
    ).toBe(bucket),
  );
  it("deduplicates donor cohorts and excludes anonymous identities", () => {
    expect(donorRetention(["a", "a", "b", ""], ["a", "c", "c"])).toEqual({
      newDonors: 1,
      recurring: 1,
      lapsed: 1,
      percent: 50,
    });
    expect(donorRetention([], ["c"]).percent).toBeNull();
  });
  it("uses time-normalised burn and avoids infinite runway", () => {
    expect(monthlyBurn(304375, 0, 30.4375, 608750)).toEqual({
      grossMinor: 304375,
      netMinor: 304375,
      runwayMonths: 2,
    });
    expect(monthlyBurn(100, 200, 30, 100).runwayMonths).toBeNull();
    expect(monthlyBurn(100, 0, 0, 0).grossMinor).toBe(0);
  });
  it("uses inclusive week starts, exclusive ends and exact signed cash", () => {
    const lines = [
      {
        id: "a",
        title: "Receipt",
        date: "2026-10-22",
        amountMinor: 100,
        source: "test",
        path: "/",
        estimated: false,
      },
      {
        id: "b",
        title: "Bill",
        date: "2026-10-29",
        amountMinor: -150,
        source: "test",
        path: "/",
        estimated: false,
      },
    ];
    expect(forecastBuckets(lines, 100, "2026-10-22", 2, "week", 100)).toEqual([
      {
        label: "2026-10-22",
        incomeMinor: 100,
        expenseMinor: 0,
        closingMinor: 200,
        low: false,
      },
      {
        label: "2026-10-29",
        incomeMinor: 0,
        expenseMinor: 150,
        closingMinor: 50,
        low: true,
      },
    ]);
  });
  it("keeps month-end dates and does not compound forecasts", () => {
    const lines = [
      {
        id: "a",
        title: "Bill",
        date: "2026-02-28",
        amountMinor: -50,
        source: "test",
        path: "/",
        estimated: true,
      },
    ];
    expect(
      forecastBuckets(lines, 100, "2026-01-31", 2, "month", 0).map(
        (b) => b.closingMinor,
      ),
    ).toEqual([100, 50]);
  });
  it("derives every month-end bucket boundary from the original forecast anchor", () => {
    expect(forecastBucketPeriod("2026-01-31", 1, "month")).toEqual({
      from: "2026-02-28", to: "2026-03-31",
    });
    expect(forecastBucketPeriod("2024-01-31", 1, "month")).toEqual({
      from: "2024-02-29", to: "2024-03-31",
    });
  });
  it("measures SLA misses and ignores unresolved MTTR rows", () => {
    const start = new Date("2026-01-01T00:00:00Z"),
      due = new Date("2026-01-01T01:00:00Z"),
      late = new Date("2026-01-01T02:00:00Z");
    expect(sla(start, late, due, late)).toEqual({ minutes: 120, missed: true });
    expect(sla(start, null, due, late).missed).toBe(true);
    expect(
      mttr([
        { startedAt: start, resolvedAt: due },
        { startedAt: start, resolvedAt: late },
        { startedAt: start, resolvedAt: null },
      ]),
    ).toBe(90);
    expect(mttr([])).toBeNull();
  });
  it("uses weighted denominators and leaves missing baselines blank", () => {
    expect(winRate(2, 3)).toBe(40);
    expect(winRate(0, 0)).toBeNull();
    expect(rate(1, 4)).toBe(25);
    expect(average(10, 4)).toBe(2.5);
    expect(average(0, 0)).toBeNull();
    expect(delta(100, 50)).toBe(100);
    expect(delta(10, 0)).toBeNull();
    expect(delta(0, 0)).toBe(0);
    expect(delta(null, 100)).toBeNull();
  });
  it("rejects unsafe totals and quotes spreadsheet formulas", () => {
    expect(() => safeNumber("9007199254740992")).toThrow();
    expect(csv([["=SUM(A1)", 'a,"b\nc']])).toContain('"\'=SUM(A1)"');
    expect(displayValue(125, "money", "INR")).toContain("1.25");
    expect(displayValue(null, "percent", "INR")).toBe("Not recorded");
  });
  it("validates query gates", () => {
    expect(querySchema.parse({}).period).toBe("month");
    expect(querySchema.safeParse({ section: "vault" }).success).toBe(false);
    expect(querySchema.safeParse({ threshold: "-1" }).success).toBe(false);
  });
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)(
    "has explicit role gates for %s",
    (role) => {
      expect(canViewAnalytics({ role })).toBe(role !== "GUEST");
      expect(canManageAnalytics({ role })).toBe(
        ["OWNER", "ADMIN"].includes(role),
      );
    },
  );
});

describe("exact-record finance source links", () => {
  it("preserves the optional record filter without changing unfiltered URLs", async () => {
    const { parseLedgerFilters, ledgerFiltersToQuery } =
      await import("@/lib/finance/filters");
    const filters = parseLedgerFilters({ record: "entry_123" });
    expect(filters.recordId).toBe("entry_123");
    expect(ledgerFiltersToQuery(filters)).toBe("?record=entry_123");
    expect(
      parseLedgerFilters({ record: "not/a/record" }).recordId,
    ).toBeUndefined();
  });
});

describe("calendar-aligned reporting comparisons", () => {
  it("compares month-to-date with the previous month-to-date", () => {
    expect(
      comparisons({ from: "2026-10-01", to: "2026-10-21" }, "month").previous,
    ).toEqual({ from: "2026-09-01", to: "2026-09-21" });
  });
  it("compares complete months and leap calendar years as complete periods", () => {
    expect(
      comparisons({ from: "2026-09-01", to: "2026-09-30" }, "last-month")
        .previous,
    ).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(
      comparisons({ from: "2024-01-01", to: "2024-12-31" }, "custom").previous,
    ).toEqual({ from: "2023-01-01", to: "2023-12-31" });
  });
  it("aligns financial years and quarters with their own calendar boundaries", () => {
    expect(
      comparisons({ from: "2026-04-01", to: "2026-04-10" }, "fy").previous,
    ).toEqual({ from: "2025-04-01", to: "2025-04-10" });
    expect(
      comparisons({ from: "2026-10-01", to: "2026-10-21" }, "quarter").previous,
    ).toEqual({ from: "2026-07-01", to: "2026-07-21" });
  });
});

describe("numeric CSV exports", () => {
  it("keeps real negative numbers numeric and neutralises user-entered formulas", () => {
    expect(csv([[-250000, "-unsafe text", "=SUM(A1)"]])).toBe(
      '\uFEFF"-250000","\'-unsafe text","\'=SUM(A1)"',
    );
  });
});

describe("cash assumptions use currency amounts", () => {
  it("preserves signed paise and currency precision", () => {
    expect(parseCashAmount("-2,500.25", "INR")).toBe(-250025);
    expect(parseCashAmount("+25", "INR")).toBe(2500);
    expect(parseCashAmount("1.001", "INR")).toBeNull();
    expect(parseCashAmount("-12", "JPY")).toBe(-12);
    expect(parseCashAmount("0.123", "KWD")).toBe(123);
    expect(parseCashAmount("--2500", "INR")).toBeNull();
    expect(parseCashAmount("a2500", "INR")).toBeNull();
  });
});
