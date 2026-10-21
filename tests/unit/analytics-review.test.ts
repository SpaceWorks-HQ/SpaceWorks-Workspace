import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Dashboard } from "@/components/analytics/Dashboard";
import { ReportPack } from "@/components/analytics/ReportPack";
import { Drill } from "@/components/analytics/Drill";
import { forecastBuckets } from "@/lib/analytics/metrics";
import { formatMoney } from "@/lib/format/money";
import type { DashboardData, DrillData, ForecastResult } from "@/lib/analytics/types";

vi.mock("@/components/analytics/Controls", () => ({
  SavedReports: () => null,
  Adjustments: () => null,
  CashThreshold: () => null,
}));

const data: DashboardData = {
  q: { section: "finance", period: "month", currency: "INR", threshold: "12345", monthlyEmail: false, emailTo: [] },
  period: { from: "2026-01-01", to: "2026-01-30" },
  metrics: [], workspaceName: "Workspace", timezone: "Asia/Kolkata", admin: true,
  viewerId: "viewer", sections: ["finance"], presets: [],
  options: { funds: [], centres: [], teams: [], projects: [], programmes: [], admins: [] },
};
const lines = ["2026-01-30", "2026-01-31", "2026-02-07", "2026-02-28", "2026-03-30", "2026-03-31"]
  .map((date, i) => ({ id: String(i), title: `Commitment ${i}`, date, amountMinor: -100, source: "Test", path: "/source", estimated: true }));
const forecast: ForecastResult = {
  incomplete: false, asOf: "2026-01-30", currency: "INR", openingMinor: 12500, openingKnown: true,
  thresholdMinor: 12345, lines, warnings: [],
  weekly: forecastBuckets(lines, 12500, "2026-01-31", 12, "week", 12345),
  monthly: forecastBuckets(lines, 12500, "2026-01-31", 6, "month", 12345),
};
const renderDashboard = () => renderToStaticMarkup(createElement(Dashboard, { data, slug: "workspace", forecast, adjustments: [] }));

describe("analytics review regressions", () => {
  it("shows Patch once in the main dashboard and drill empty states", () => {
    expect(renderDashboard().match(/data-patch="idle"/g)).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(Drill, { slug: "workspace", metric: "income", data: {
      title: "Income", description: "Source records", unit: "money", basisUnit: "money", q: data.q,
      period: data.period, rows: [], page: 1, more: false,
    } }));
    expect(html.match(/data-patch="idle"/g)).toHaveLength(1);
    expect(html).toContain("Reset filters");
  });

  it("discloses incomplete forecasts in both the dashboard and printable pack", () => {
    const incomplete = { ...forecast, incomplete: true, warnings: ["Forecast incomplete: review overdue schedules."] };
    const dashboard = renderToStaticMarkup(createElement(Dashboard, { data, slug: "workspace", forecast: incomplete, adjustments: [] }));
    const report = renderToStaticMarkup(createElement(ReportPack, { data: {
      title: "Management report", name: "Workspace", kind: "management", preset: { name: "Monthly", commentary: "" },
      q: data.q, metrics: [], forecast: incomplete, slug: "workspace", period: data.period,
    } }));
    for (const html of [dashboard, report]) {
      expect(html).toContain("Incomplete forecast");
      expect(html).toContain("Forecast incomplete: review overdue schedules.");
    }
    expect(report.match(/<h1\b/g)).toHaveLength(1);
  });

  it.each(["INR", "JPY", "KWD"])("formats both ratio amounts using %s minor units", (currency) => {
    const drill: DrillData = {
      title: "Budget utilisation", description: "Actual / budget", unit: "percent", basisUnit: "money",
      q: { ...data.q, currency }, period: data.period, page: 1, more: false,
      rows: [{ id: "budget", title: "Budget", path: "/budget", date: "2026-01-10", label: "Budget", value: 12500, base: 50000 }],
    };
    const html = renderToStaticMarkup(createElement(Drill, { data: drill, slug: "workspace", metric: "budgets" }));
    expect(html).toContain(formatMoney(12500, currency));
    expect(html).toContain(formatMoney(50000, currency));
  });

  it("preserves the selected forecast threshold in the CSV link", () => {
    const html = renderDashboard();
    const href = html.match(/href="([^"]+)"[^>]*>Export forecast CSV</)?.[1];
    expect(href).toBeDefined();
    const url = new URL(href!.replaceAll("&amp;", "&"), "https://example.test");
    expect(url.searchParams.get("kind")).toBe("forecast");
    expect(url.searchParams.get("currency")).toBe("INR");
    expect(url.searchParams.get("threshold")).toBe(data.q.threshold);
  });

  it("keeps the gift count denominator separate from a monetary average", () => {
    const drill: DrillData = {
      title: "Average gift", description: "Gift amount / count", unit: "money", basisUnit: "money",
      q: data.q, period: data.period, page: 1, more: false,
      rows: [{ id: "gift", title: "Gift", path: "/gift", date: "2026-01-10", label: "Gift", value: 12500, base: 1 }],
    };
    const html = renderToStaticMarkup(createElement(Drill, { data: drill, slug: "workspace", metric: "average-gift" }));
    expect(html).toContain(formatMoney(12500, "INR"));
    expect(html).toMatch(/<td\b[^>]*>1<\/td>/);
  });

  it.each([
    ["Next 12 weeks", [1, 1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]],
    ["Next 6 months", [2, 2, 1, 0, 0, 0]],
  ] as const)("counts only records inside each %s bucket", (title, counts) => {
    const html = renderDashboard();
    const figure = html.split(`<figure class="min-w-0" aria-label="${title}">`)[1]?.split("</figure>")[0];
    expect(figure).toBeDefined();
    const recordCounts = [...figure!.matchAll(/<td\b[^>]*><a\b[^>]*>(\d+)<\/a><\/td>/g)].map((m) => Number(m[1]));
    expect(recordCounts).toEqual(counts);
  });
});
