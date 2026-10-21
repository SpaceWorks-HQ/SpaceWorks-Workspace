import { Card, Chip } from "@/components/ui/display";
import { Chart } from "./Chart";
import { CashThreshold } from "./Controls";
import type { AnalyticsQuery, ForecastResult } from "@/lib/analytics/types";
import {
  displayValue,
  queryString,
  monthlyBurn,
  addDays,
  forecastBucketPeriod,
} from "@/lib/analytics/metrics";

export function DashboardForecast({
  forecast,
  burn,
  slug,
  q,
  currency,
}: {
  forecast: ForecastResult;
  burn: ReturnType<typeof monthlyBurn> | null;
  slug: string;
  q: AnalyticsQuery;
  currency: string;
}) {
  const base = `/w/${slug}/analytics`,
    fmt = (n: number | null, u: "count" | "money" | "percent") =>
      displayValue(n, u, currency);
  return (
    <Card
      as="section"
      id="forecast"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h2">Cash-flow forecast</h2>
        <Chip tone={forecast.incomplete ? "warning" : "info"}>
          {forecast.incomplete ? "Incomplete forecast" : "Estimate"}
        </Chip>
      </div>
      <p>
        {forecast.openingKnown
          ? "Opening cash"
          : "Assumed opening cash · no accounts recorded"}{" "}
        as of {forecast.asOf}:{" "}
        <a
          className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
          href={`/w/${slug}/finance/funds?currency=${currency}`}
        >
          {fmt(forecast.openingMinor, "money")}
        </a>
      </p>
      {!forecast.openingKnown ? (
        <p className="text-warning-fg">
          Closing cash assumes a zero opening balance. Add a finance account
          before using these projections.
        </p>
      ) : null}
      {burn ? (
        <p>
          Monthly gross burn {fmt(burn.grossMinor, "money")} · Net burn{" "}
          {fmt(burn.netMinor, "money")} ·{" "}
          {burn.runwayMonths === null
            ? "Income covered expenses in this period."
            : `${burn.runwayMonths.toFixed(1)} months of runway at this period’s burn.`}
        </p>
      ) : null}
      <CashThreshold
        slug={slug}
        q={q}
        currency={currency}
        value={forecast.thresholdMinor}
      />
      <ul className="space-y-1 text-body-sm text-ink-muted">
        {forecast.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <div className="grid gap-5 md:grid-cols-2">
        {[
          ["Next 12 weeks", forecast.weekly],
          ["Next 6 months", forecast.monthly],
        ].map(([title, buckets]) => (
          <div key={String(title)}>
            <Chart
              title={String(title)}
              points={(buckets as ForecastResult["weekly"]).map((b, i) => {
                const { from, to } = forecastBucketPeriod(
                  addDays(forecast.asOf, 1),
                  i,
                  title === "Next 12 weeks" ? "week" : "month",
                );
                return {
                  label: b.label,
                  value: b.closingMinor,
                  base: 0,
                  count: forecast.lines.filter(
                    (l) => l.date >= from && l.date < to,
                  ).length,
                };
              })}
              kind="line"
              unit="money"
              currency={currency}
              href={`${base}/drill/forecast?currency=${currency}&cadence=${title === "Next 12 weeks" ? "week" : "month"}`}
              dimension="bucket"
            />
            <p className="text-body-sm">
              {forecast.openingKnown
                ? `${(buckets as ForecastResult["weekly"]).filter((b) => b.low).length} periods fall below the threshold.`
                : "Add an opening balance to assess the threshold."}
            </p>
          </div>
        ))}
      </div>
      <a
        className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
        href={`${base}/export?${queryString({ currency, threshold: q.threshold }, { kind: "forecast" })}`}
      >
        Export forecast CSV
      </a>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
          Forecast assumptions and source records ({forecast.lines.length})
        </summary>
        <ul className="divide-y divide-line">
          {forecast.lines.map((l) => (
            <li
              key={`${l.source}:${l.id}`}
              className="flex flex-wrap justify-between gap-2 py-3"
            >
              <a href={l.path} className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline">
                {l.date} · {l.title} · {l.source}
              </a>
              <span>
                {fmt(l.amountMinor, "money")} ·{" "}
                <Chip tone={l.estimated ? "info" : "neutral"}>{l.estimated ? "Estimate" : "Recorded balance"}</Chip>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
