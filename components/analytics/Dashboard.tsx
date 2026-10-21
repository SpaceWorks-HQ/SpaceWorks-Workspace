import { Field, Input } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Patch } from "@/components/brand/Patch";
import { PageHeader } from "@/components/ui/display";
import { Chart } from "./Chart";
import {
  SavedReports,
  Adjustments,
  CashThreshold,
  type AdjustmentRow,
} from "./Controls";
import { SECTION_LABELS, type ForecastResult } from "@/lib/analytics/types";
import {
  delta,
  displayValue,
  queryString,
  displayDay,
  monthlyBurn,
  comparisons,
  addDays,
  forecastBucketPeriod,
} from "@/lib/analytics/metrics";
import type { DashboardData } from "@/lib/analytics/types";
function change(value: number | null, baseline: number | null) {
  const d = delta(value, baseline);
  return d === null
    ? "No comparable baseline"
    : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}
export function Dashboard({
  data,
  slug,
  forecast,
  adjustments,
}: {
  data: DashboardData;
  slug: string;
  forecast: ForecastResult | null;
  adjustments: AdjustmentRow[];
}) {
  const { q, period, metrics, options } = data,
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
  const fields: [
    "fund" | "centre" | "team" | "project" | "programme",
    string,
    { id: string; name: string }[],
  ][] = [
    ["fund", "Fund", options.funds],
    ["centre", "Cost centre", options.centres],
    ["team", "Team", options.teams],
    ["project", "Project", options.projects],
    ["programme", "Programme", options.programmes],
  ];
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Reports and analytics"
        description="See what changed, open the evidence, and decide what needs attention."
      />
      <nav
        aria-label="Analytics sections"
        className="flex gap-4 overflow-x-auto border-b border-line"
      >
        {data.sections.map((section) => (
          <a
            key={section}
            className={`shrink-0 border-b-2 px-1 py-3 text-body-sm ${q.section === section ? "border-primary text-ink" : "border-transparent text-ink-muted"}`}
            aria-current={q.section === section ? "page" : undefined}
            href={`${base}?${queryString(q, { section, group: undefined, page: undefined })}`}
          >
            {SECTION_LABELS[section]}
          </a>
        ))}
      </nav>
      <form
        method="get"
        className="grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-2 lg:grid-cols-4 print:hidden"
      >
        <input type="hidden" name="section" value={q.section} />
        <Field label="Reporting period">
          <Dropdown name="period" defaultValue={q.period}>
            <option value="month">This month to date</option>
            <option value="last-month">Last month</option>
            <option value="quarter">Quarter to date</option>
            <option value="fy">Indian financial year to date (Apr–Mar)</option>
            <option value="custom">Custom dates</option>
          </Dropdown>
        </Field>
        <Field label="From · custom period">
          <Input name="from" type="date" defaultValue={period.from} />
        </Field>
        <Field label="To · custom period">
          <Input name="to" type="date" defaultValue={period.to} />
        </Field>
        <Field label="Currency">
          <Input
            name="currency"
            pattern="[A-Z]{3}"
            maxLength={3}
            defaultValue={currency}
            required
          />
        </Field>
        {fields
          .filter(([, , items]) => items.length)
          .map(([key, label, items]) => (
            <Field key={key} label={label}>
              <Dropdown name={key} defaultValue={q[key] ?? ""}>
                <option value="">All</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Dropdown>
            </Field>
          ))}
        <div className="flex items-end gap-3">
          <Button type="submit">Apply filters</Button>
          <a
            className="inline-flex min-h-11 items-center text-accent-text underline"
            href={`${base}?section=${q.section}`}
          >
            Reset
          </a>
        </div>
      </form>
      {q.section === "home" && data.presets.some((p) => p.pinned) ? (
        <section
          aria-label="Pinned reports"
          className="flex flex-wrap items-center gap-3"
        >
          <h2 className="text-label">Pinned reports</h2>
          {data.presets
            .filter((p) => p.pinned)
            .map((p) => (
              <a
                key={p.id}
                className="inline-flex min-h-11 max-w-full items-center break-words rounded-md border border-line bg-panel px-4 text-accent-text underline"
                href={`${base}?${queryString(p.query)}`}
              >
                {p.name}
              </a>
            ))}
        </section>
      ) : null}
      <p className="text-body-sm text-ink-muted">
        {displayDay(period.from)} to {displayDay(period.to)} · {data.timezone} ·{" "}
        {currency}. Comparisons use the preceding calendar period through the
        same elapsed day, and the same dates last year. Custom ranges use the
        preceding equal-length range. Area filters hide metrics without a
        matching dimension.
      </p>
      {insights.length ? (
        <aside className="rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h3">What needs attention</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {insights.map((i) => (
              <li key={i.text}>
                <a
                  className="block min-h-11 text-accent-text underline"
                  href={i.href}
                >
                  {i.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      {!metrics.some((m) => m.count) ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-panel p-6 text-center">
          <Patch size={100} />
          <p>No matching records yet. Start with the team’s source tools.</p>
          <a
            href={`/w/${slug}/${q.section === "finance" ? "finance/ledger" : q.section === "funding" ? "funding/tracker" : q.section === "people" ? "members" : q.section === "operations" ? "helpdesk" : q.section === "marketing" ? "marketing" : "projects"}`}
            className="inline-flex min-h-11 items-center text-accent-text underline"
          >
            Open source records
          </a>
        </div>
      ) : null}
      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        {metrics.map((m) => (
          <section
            key={m.id}
            className="min-w-0 break-inside-avoid rounded-xl border border-line bg-panel p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-h3">{m.title}</h2>
              <a
                className="inline-flex min-h-11 items-center text-body-sm text-accent-text underline"
                href={m.csv}
              >
                Export CSV
              </a>
            </div>
            <a
              className="inline-block min-h-11 py-1 text-h1 tabular-nums text-accent-text"
              href={m.drill}
            >
              {displayValue(m.value, m.unit, currency)}
            </a>
            <p className="text-caption text-ink-muted">
              {m.snapshot ? (
                "Current state at the selected end; historical comparisons unavailable."
              ) : (
                <>
                  <a
                    className="text-accent-text underline"
                    href={comparisonLink(m.id, "previous")}
                  >
                    Previous: {change(m.value, m.previous)}
                  </a>
                  {" · "}
                  <a
                    className="text-accent-text underline"
                    href={comparisonLink(m.id, "lastYear")}
                  >
                    Last year: {change(m.value, m.lastYear)}
                  </a>
                </>
              )}
            </p>
            <p className="my-3 text-body-sm text-ink-muted">{m.description}</p>
            {m.trend.length > 1 && !m.snapshot ? (
              <Chart
                title={`${m.title} trend`}
                points={m.trend}
                kind="sparkline"
                unit={m.unit}
                currency={currency}
                href={m.drill}
                dimension="bucket"
                compact
              />
            ) : null}
            <Chart
              title={m.title}
              points={m.groups}
              kind={m.chart}
              unit={m.id === "win-rate" ? "count" : m.unit}
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
              currency={currency}
              href={m.drill}
            />
            <a
              className="mt-2 inline-flex min-h-11 items-center text-body-sm text-accent-text underline"
              href={m.drill}
            >
              Open {m.count} underlying records
            </a>
          </section>
        ))}
      </div>
      {forecast ? (
        <section
          id="forecast"
          className="space-y-4 rounded-xl border border-line bg-panel p-5"
        >
          <h2 className="text-h2">Cash-flow forecast</h2>
          <p>
            {forecast.openingKnown
              ? "Opening cash"
              : "Assumed opening cash · no accounts recorded"}{" "}
            as of {forecast.asOf}:{" "}
            <a
              className="text-accent-text underline"
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
            className="inline-flex min-h-11 items-center text-accent-text underline"
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
                  <a href={l.path} className="text-accent-text underline">
                    {l.date} · {l.title} · {l.source}
                  </a>
                  <span>
                    {fmt(l.amountMinor, "money")} ·{" "}
                    {l.estimated ? "Estimate" : "Recorded balance"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : null}
      {data.admin && q.section === "finance" ? (
        <Adjustments slug={slug} currency={currency} rows={adjustments} />
      ) : null}
      <SavedReports
        slug={slug}
        q={q}
        presets={data.presets}
        admin={data.admin}
        viewerId={data.viewerId}
        admins={options.admins}
      />
    </div>
  );
}
