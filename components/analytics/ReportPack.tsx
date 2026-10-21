import type {
  MetricResult,
  AnalyticsQuery,
  ForecastResult,
} from "@/lib/analytics/types";
import { displayValue, displayDay, comparisons } from "@/lib/analytics/metrics";
import { Chart } from "./Chart";
import { PrintButton } from "@/components/finance/PrintButton";
export function ReportPack({
  data,
}: {
  data: {
    title: string;
    name: string;
    kind: string;
    preset: { name: string; commentary: string };
    q: AnalyticsQuery;
    metrics: MetricResult[];
    forecast?: ForecastResult | null;
    slug: string;
    period: { from: string; to: string };
  };
}) {
  const currency = data.q.currency ?? "INR",
    comparison = comparisons(data.period, data.q.period);
  return (
    <article id="analytics-print" className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <a
          className="min-h-11 py-3 text-accent-text underline"
          href={`/w/${data.slug}/analytics`}
        >
          Back to analytics
        </a>
        <PrintButton />
      </div>
      <header className="border-b-2 border-primary pb-6">
        <p className="text-overline text-accent-text">
          Space Works · Private internal report
        </p>
        <h1 className="mt-3 text-h1">{data.title}</h1>
        <p className="mt-2 text-h3">{data.name}</p>
        <p>
          {displayDay(data.period.from)} to {displayDay(data.period.to)} ·{" "}
          {currency}
        </p>
        <p className="mt-2 text-body-sm text-ink-muted">
          Previous period {comparison.previous.from} to {comparison.previous.to}
          . Last year {comparison.lastYear.from} to {comparison.lastYear.to}.
        </p>
      </header>
      <section>
        <h2 className="text-h2">Commentary</h2>
        <p className="mt-3 whitespace-pre-wrap break-words">
          {data.preset.commentary ||
            "No commentary added. Review the figures and add context before sharing."}
        </p>
      </section>
      <p className="text-body-sm text-ink-muted">
        Prepared from manual source records. Private payroll, donor rankings,
        confidential help requests and private meetings are excluded.
        Current-state measures carry no historical comparison. Values are not
        added across registers, currencies or KPI units.
      </p>
      {data.forecast ? (
        <section className="break-inside-avoid rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h2">
            Cash-flow forecast · as of {displayDay(data.forecast.asOf)}
          </h2>
          <p className="mt-2">
            {data.forecast.openingKnown
              ? "Opening cash"
              : "Assumed opening cash · no accounts recorded"}{" "}
            {displayValue(data.forecast.openingMinor, "money", currency)} ·
            Low-balance threshold{" "}
            {displayValue(data.forecast.thresholdMinor, "money", currency)}
          </p>
          <p className="mt-2 text-caption text-ink-muted">
            Private payroll commitments are excluded from shared report packs.
            Use the payroll-permitted analytics view for a complete private
            forecast.
          </p>
          {data.forecast.openingKnown ? (
            <>
              <Chart
                openTable
                title="Next twelve weeks · closing cash"
                points={data.forecast.weekly.map((b) => ({
                  label: b.label,
                  value: b.closingMinor,
                  base: 0,
                  count: 1,
                }))}
                unit="money"
                kind="line"
                currency={currency}
                href={`/w/${data.slug}/analytics/drill/forecast?currency=${currency}&cadence=week`}
                dimension="bucket"
              />
              <Chart
                openTable
                title="Next six months · closing cash"
                points={data.forecast.monthly.map((b) => ({
                  label: b.label,
                  value: b.closingMinor,
                  base: 0,
                  count: 1,
                }))}
                unit="money"
                kind="line"
                currency={currency}
                href={`/w/${data.slug}/analytics/drill/forecast?currency=${currency}&cadence=month`}
                dimension="bucket"
              />
            </>
          ) : (
            <p className="mt-3 text-warning-fg">
              Add a finance account opening balance before using closing cash
              projections.
            </p>
          )}
        </section>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
        {data.metrics.map((m) => (
          <section
            key={m.id}
            className="min-w-0 break-inside-avoid rounded-xl border border-line bg-panel p-5"
          >
            <h2 className="text-h3">{m.title}</h2>
            <a
              href={m.csv}
              className="inline-flex min-h-11 items-center text-accent-text underline print:hidden"
            >
              Export CSV
            </a>
            <p className="my-2 text-h2 tabular-nums">
              {displayValue(m.value, m.unit, currency)}
            </p>
            <p className="text-body-sm">
              Previous {displayValue(m.previous, m.unit, currency)} · Last year{" "}
              {displayValue(m.lastYear, m.unit, currency)}
            </p>
            <p className="my-3 text-caption text-ink-muted">{m.description}</p>
            <Chart
              openTable
              basisUnit={
                [
                  "budgets",
                  "campaigns",
                  "grant-utilisation",
                  "bom",
                  "bom-received",
                ].includes(m.id)
                  ? "money"
                  : "count"
              }
              title={m.title}
              points={m.groups}
              unit={m.id === "win-rate" ? "count" : m.unit}
              kind={m.chart}
              currency={currency}
              href={m.drill}
            />
          </section>
        ))}
      </div>
      <footer className="border-t border-line py-4 text-body-sm text-ink-muted">
        Space Works Workspace · {data.preset.name} · Review source records
        before making commitments.
      </footer>
    </article>
  );
}
