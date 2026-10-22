import type { DashboardData, ForecastResult } from "@/lib/analytics/types";
import {
  delta,
  displayValue,
  queryString,
  monthlyBurn,
  comparisons,
} from "@/lib/analytics/metrics";

export function change(value: number | null, baseline: number | null) {
  const d = delta(value, baseline);
  return d === null
    ? "No comparable baseline"
    : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}

export function dashboardSummary(
  data: DashboardData,
  slug: string,
  forecast: ForecastResult | null,
) {
  const { q, period, metrics } = data,
    currency = q.currency!,
    base = `/w/${slug}/analytics`,
    fmt = (n: number | null, u: "count" | "money" | "percent") =>
      displayValue(n, u, currency),
    find = (id: string) => metrics.find((m) => m.id === id),
    insights: { text: string; href: string }[] = [];
  const comparison = comparisons(period, q.period);
  const comparisonLink = (
    metric: string,
    which: "previous" | "lastYear",
    group?: string,
  ) =>
    `${base}/drill/${metric}?${queryString({ ...q, period: "custom", ...comparison[which], page: undefined, bucket: undefined, group })}`;
  const payables = find("payables");
  if (payables?.value)
    insights.push({
      text: `${fmt(payables.value, "money")} of supplier dues remain unpaid at the selected end.`,
      href: payables.drill,
    });
  const spend = find("spending"),
    income = find("income"),
    sla = find("help-sla"),
    attendance = find("attendance"),
    overdue = find("overdue-tasks"),
    reports = find("grant-reports"),
    health = find("project-health"),
    budgets = find("budgets");
  const biggest = spend?.groups
    .filter((g) => g.previous !== null && g.previous !== undefined)
    .sort(
      (a, b) =>
        Math.abs(b.value - b.previous!) - Math.abs(a.value - a.previous!),
    )[0];
  if (biggest && biggest.value !== biggest.previous)
    insights.push({
      text: `Largest spending change: ${biggest.label}, ${fmt(biggest.value, "money")} compared with ${fmt(biggest.previous!, "money")} in the previous period.`,
      href: biggest.count
        ? `${spend!.drill}&group=${encodeURIComponent(biggest.label)}`
        : comparisonLink("spending", "previous", biggest.label),
    });
  if (
    spend?.previous !== null &&
    spend?.value !== null &&
    spend?.previous !== undefined
  )
    insights.push({
      text: `Spending changed by ${change(spend.value, spend.previous)} against the previous period. Review categories before changing a budget.`,
      href: spend.drill,
    });
  if (sla?.value)
    insights.push({
      text: `${fmt(sla.value, "percent")} of visible help requests missed their resolution deadline.`,
      href: sla.drill,
    });
  if (
    attendance?.value !== null &&
    attendance?.previous !== null &&
    attendance?.value !== undefined &&
    attendance?.previous !== undefined &&
    attendance.value < attendance.previous
  )
    insights.push({
      text: `Recorded attendance dipped by ${(attendance.previous - attendance.value).toFixed(1)} percentage points. Check missing records before drawing conclusions.`,
      href: attendance.drill,
    });
  if (overdue?.value)
    insights.push({
      text: `${overdue.value} tasks are overdue and still open.`,
      href: overdue.drill,
    });
  if (reports?.value)
    insights.push({
      text: `${reports.value} grant reports or deliverables are due in this period.`,
      href: reports.drill,
    });
  const offTrack = health?.groups.find((g) => g.label === "OFF_TRACK");
  if (offTrack?.count)
    insights.push({
      text: `${offTrack.count} projects have an off-track check-in.`,
      href: `${health!.drill}&group=OFF_TRACK`,
    });
  const overBudget = budgets?.groups.filter((g) => g.value >= 90);
  if (overBudget?.length)
    insights.push({
      text: `${overBudget.length} budget lines have used at least 90% of their envelope.`,
      href: budgets!.drill,
    });
  let burn: null | ReturnType<typeof monthlyBurn> = null;
  if (
    forecast &&
    forecast.openingKnown &&
    spend?.value !== null &&
    income?.value !== null &&
    spend?.value !== undefined &&
    income?.value !== undefined
  ) {
    burn = monthlyBurn(
      spend.value,
      income.value,
      Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86400000) +
        1,
      forecast.openingMinor,
    );
    if (burn.runwayMonths !== null && burn.runwayMonths < 3)
      insights.push({
        text: `Cash covers about ${burn.runwayMonths.toFixed(1)} months at this period’s net burn. Forecast commitments may change that estimate.`,
        href: `${base}?section=finance#forecast`,
      });
  }
  return { currency, base, insights, burn, comparisonLink };
}
