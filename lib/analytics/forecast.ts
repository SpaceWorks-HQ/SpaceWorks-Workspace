import "server-only";
import { forecastSources } from "./forecast/sources";
import { forecastLines } from "./forecast/lines";
import { context } from "./queries";
import { AnalyticsError, type Actor } from "./access";
import {
  addMonths,
  forecastBuckets,
  forecastBucketPeriod,
  safeNumber,
  addDays,
} from "./metrics";
import { localDate } from "@/lib/finance/dates";
import type {
  AnalyticsQuery,
  ForecastResult,
  DrillData,
} from "./types";
export async function cashForecast(
  actor: Actor,
  raw: AnalyticsQuery = {},
  now = new Date(),
  includePayroll = true,
): Promise<ForecastResult> {
  const { access: a, q } = await context(actor, raw, now);
  if (!a.admin)
    throw new AnalyticsError("Ask a finance admin to open the cash forecast.");
  if (q.fund || q.centre || q.team || q.project || q.programme)
    throw new AnalyticsError(
      "Clear the area filters for the account-level cash forecast. Account opening balances are not allocated to funds or projects.",
    );
  const showPayroll = a.payroll && includePayroll;
  const currency = q.currency!,
    today = localDate(now, a.workspace.timezone),
    start = addDays(today, 1),
    end = addMonths(start, 6),
    threshold = Number(q.threshold ?? 10000000);
  const sources = await forecastSources(
    a,
    currency,
    today,
    start,
    end,
    showPayroll,
  );
  const { opening, budgets } = sources;
  const { lines, projectionWarnings } = forecastLines(
    sources,
    today,
    start,
    end,
    `/w/${a.workspace.slug}`,
  );
  const openingMinor = safeNumber(opening[0]?.amount ?? 0),
    openingKnown = Number(opening[0]?.accounts ?? 0) > 0;
  return {
    asOf: today,
    incomplete: projectionWarnings.length > 0,
    currency,
    openingMinor,
    openingKnown,
    thresholdMinor: threshold,
    weekly: forecastBuckets(
      lines,
      openingMinor,
      start,
      12,
      "week",
      threshold,
    ).map((b) => ({ ...b, low: openingKnown && b.low })),
    monthly: forecastBuckets(
      lines,
      openingMinor,
      start,
      6,
      "month",
      threshold,
    ).map((b) => ({ ...b, low: openingKnown && b.low })),
    lines,
    warnings: [
      ...projectionWarnings,
      ...(!openingKnown
        ? [
            `No finance accounts have an opening balance for ${currency} by the as-of date. Closing cash is an illustrative change from zero until accounts are recorded.`,
          ]
        : []),
      "Only entered commitments are included. Unentered pay runs and costs are not assumed.",
      "Opening balance includes all recorded account movements through today. Unassigned ledger entries do not alter account balances.",
      "Overdue commitments are carried into the first forecast day. Future cash dates are estimates; payroll uses day 28 when no pay date is stored.",
      ...(showPayroll
        ? []
        : [
            "Private payroll and statutory commitments are omitted from this view. Use the payroll-permitted analytics view for the complete private forecast. Opening cash remains aggregate.",
          ]),
      `${budgets.length} overlapping budgets (${budgets.reduce((n, b) => n + b.amountMinor, 0)} minor units) are spending envelopes, not dated cash obligations. They are excluded to avoid counting the same bills twice; add a one-off adjustment for uncommitted planned spending.`,
      "Receivables use current outstanding balances and their due dates; legacy copies linked to controlled issued invoices are excluded. They remain estimates until payment is logged.",
      "Pledges and grants must not describe the same receipt twice. Subscriptions, rent, insurance and EMIs enter through recurring schedules; no second projection is added from their source registers.",
    ],
  };
}
export async function forecastDrill(
  actor: Actor,
  raw: AnalyticsQuery = {},
  limit = 50,
): Promise<DrillData> {
  const { q } = await context(actor, raw),
    f = await cashForecast(actor, q),
    cadence = q.cadence === "week" ? "week" : "month",
    buckets = cadence === "week" ? f.weekly : f.monthly,
    index = q.bucket ? buckets.findIndex((b) => b.label === q.bucket) : 0;
  if (index < 0)
    throw new AnalyticsError("Choose a bucket from the current forecast.");
  const { from, to } = forecastBucketPeriod(addDays(f.asOf, 1), index, cadence),
    page = Math.max(1, Number(q.page ?? 1));
  const rows = f.lines.filter((l) => l.date >= from && l.date < to),
    selected = rows.slice((page - 1) * limit, page * limit);
  return {
    title: "Cash forecast assumptions",
    description: `${f.incomplete ? f.warnings.filter((w) => w.startsWith("Forecast incomplete:")).join(" ") + " " : ""}Opening cash for this bucket ${f.openingMinor + f.lines.filter((l) => l.date < from).reduce((n, l) => n + l.amountMinor, 0)} ${f.currency} minor units, including earlier forecast lines from the account balance as of ${f.asOf}. These are projected cash lines, not accounting entries. Open each source to review it.`,
    unit: "money" as const,
    basisUnit: "money",
    q,
    period: { from, to: addDays(to, -1) },
    page,
    more: rows.length > page * limit,
    rows: selected.map((l) => ({
      id: l.id,
      title: l.title,
      path: l.path,
      date: l.date,
      label: l.source,
      value: l.amountMinor,
      base: 0,
    })),
  };
}
