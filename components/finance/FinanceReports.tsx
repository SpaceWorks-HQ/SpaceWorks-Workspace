import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/money";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import type { FinanceActor } from "@/lib/finance/tools/access";
import type { FinanceReportsView } from "@/lib/finance/tools/views";
import { FinanceFilters } from "./FinanceFilters";
import { MonthlyChart } from "./MonthlyChart";
import { PrintButton } from "./PrintButton";
import { ReportPdfButton } from "./ReportPdfButton";
import { GroupTable, byName } from "./FinanceReportGroupTable";
import { FinanceSpendingReview } from "./FinanceSpendingReview";
import { FinanceReportEntries } from "./FinanceReportEntries";
import { FinanceReportBudgets } from "./FinanceReportBudgets";

export { GroupTable } from "./FinanceReportGroupTable";

const EXPORTS = [
  ["entries", "Ledger with receipts"],
  ["bills", "Bills"],
  ["funds", "Funds"],
  ["budgets", "Budgets"],
  ["income-sources", "Income by source"],
  ["income-funders", "Income by donor or funder"],
  ["spending-categories", "Spending by category"],
  ["spending-vendors", "Spending by vendor"],
  ["centres", "Cost centre statements"],
  ["cash-flow", "Monthly cash flow"],
  ["disbursements", "Disbursements"],
  ["disbursement-purposes", "Disbursements by purpose"],
  ["disbursement-centres", "Disbursements by programme"],
] as const;
export function FinanceReportsScreen({
  actor,
  query,
  view,
  spending = false,
  print = false,
}: {
  actor: FinanceActor;
  query: FinanceQuery;
  view: FinanceReportsView;
  spending?: boolean;
  print?: boolean;
}) {
  const { data, pickers: p, manage } = view;
  // Only the spending review carries duplicate pairs.
  const review = "duplicates" in data ? data : null;
  const slug = actor.workspace.slug,
    base = `/w/${slug}/finance`,
    c = data.period.currency;
  const params = new URLSearchParams({
    from: data.period.from,
    to: data.period.to,
    currency: c,
    ...(query.centre ? { centre: query.centre } : {}),
  });
  const exp = (kind: string) => `${base}/export/${kind}?${params}`;
  const budgetCentre = new Map<string, number>(),
    budgetCategory = new Map<string, number>();
  for (const b of data.budgets.filter(
    (b) =>
      b.periodStart.toISOString().slice(0, 10) === data.period.from &&
      b.periodEnd.toISOString().slice(0, 10) === data.period.to,
  )) {
    const centre =
      p.centres.find((a) => a.id === b.costCentreId)?.name ?? "No cost centre";
    budgetCentre.set(centre, (budgetCentre.get(centre) ?? 0) + b.amountMinor);
    for (const id of b.categories) {
      const category =
        p.categories.find((a) => a.id === id)?.name ?? "Uncategorised";
      budgetCategory.set(
        category,
        (budgetCategory.get(category) ?? 0) + b.amountMinor,
      );
    }
  }
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1),
    entries = print
      ? data.entries
      : data.entries.slice((page - 1) * 40, page * 40);
  const income = data.entries.reduce(
      (n, e) => n + (e.kind === "INCOME" ? e.amountMinor : 0),
      0,
    ),
    expense = data.entries.reduce(
      (n, e) => n + (e.kind === "EXPENSE" ? e.amountMinor : 0),
      0,
    );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-h2">
          {spending
            ? "Review spending"
            : print
              ? `${actor.workspace.name} finance report`
              : "Reports and accountant export"}
        </h2>
        <p className="text-ink-muted">
          {data.period.from} to {data.period.to} · {c}. Payroll details stay in
          the pay register.
        </p>
      </div>
      {!print ? (
        <FinanceFilters
          query={{
            ...query,
            month: data.period.month,
            from: data.period.from,
            to: data.period.to,
          }}
          month
          period={!spending}
          centres={p.centres}
          currency={c}
        />
      ) : null}
      {!data.entries.length ? (
        <EmptyState
          patch
          title="No entries in this period. Record the next receipt."
          action={
            <Link
              href={manage ? `${base}/receipt` : `/w/${slug}/requests`}
              className={buttonClasses({ variant: "secondary" })}
            >
              {manage ? "Add an entry" : "Open requests"}
            </Link>
          }
        />
      ) : null}
      <Card>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            ["Money in", income],
            ["Money out", expense],
            ["Net", income - expense],
          ].map(([name, amount]) => (
            <div key={name}>
              <dt className="text-ink-muted">{name}</dt>
              <dd className="text-h2 tabular-nums">
                {formatMoney(Number(amount), c)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      {!print ? (
        <Card className="print:hidden">
          <CardHeader
            title="Share with your accountant"
            description="CSV files open in Excel. Amounts use decimal major units and an explicit currency."
          />
          <div className="flex flex-wrap gap-2">
            {EXPORTS.map(([kind, name]) => (
              <a
                key={kind}
                href={exp(kind)}
                className={buttonClasses({ variant: "secondary" })}
              >
                {name} CSV
              </a>
            ))}
            <Link
              href={`${base}/reports/print?${params}`}
              className={buttonClasses({ variant: "secondary" })}
            >
              Printable report
            </Link>
            {manage ? (
              <ReportPdfButton
                slug={slug}
                query={{
                  from: data.period.from,
                  to: data.period.to,
                  currency: c,
                  centre: query.centre,
                }}
              />
            ) : null}
          </div>
        </Card>
      ) : (
        <div className="print:hidden">
          <PrintButton />
        </div>
      )}
      <GroupTable
        title="Income by source"
        rows={data.incomeBySource}
        currency={c}
      />
      <GroupTable
        title="Income by donor or funder"
        rows={data.incomeByFunder}
        currency={c}
      />
      <GroupTable
        title={
          review
            ? "Category spending: this month, last month and budget"
            : "Spending by category"
        }
        rows={data.spendingByCategory}
        currency={c}
        budget={budgetCategory.size ? budgetCategory : undefined}
        previous={
          review
            ? byName(
                review.previous,
                (e) => e.category?.name ?? "Uncategorised",
              )
            : undefined
        }
      />
      <GroupTable
        title="Paid disbursements by purpose"
        rows={data.disbursementPurposes}
        currency={c}
      />
      <GroupTable
        title="Paid disbursements by programme"
        rows={data.disbursementCentres}
        currency={c}
      />
      <GroupTable
        title="Spending by vendor"
        rows={data.spendingByVendor}
        currency={c}
      />
      <GroupTable
        title="Event, programme, project and team statements"
        rows={data.centres}
        currency={c}
        budget={budgetCentre.size ? budgetCentre : undefined}
        previous={
          review
            ? byName(
                review.previous,
                (e) => e.costCentre?.name ?? "No cost centre",
              )
            : undefined
        }
      />
      <Card>
        <CardHeader title="Monthly cash flow" description="Cash received and paid, including aggregate payroll, loan principal and deposits. Internal transfers are excluded. Income and spending tables retain their expense basis." />
        {data.monthly.length ? (
          <MonthlyChart
            currency={c}
            data={data.monthly.map((m) => ({
              month: m.name,
              label: m.name,
              incomeMinor: m.incomeMinor,
              expenseMinor: m.expenseMinor,
            }))}
          />
        ) : (
          <p className="text-ink-muted">No cash movements in this period.</p>
        )}
      </Card>
      <FinanceReportBudgets data={data} />
      {review ? <FinanceSpendingReview review={review} view={view} slug={slug} page={page} exp={exp} /> : null}
      <FinanceReportEntries view={view} entries={entries} slug={slug} page={page} print={print} spending={spending} />
      {!print ? (
        <nav
          className="flex flex-wrap justify-between gap-3"
          aria-label="Entry pages"
        >
          {page > 1 ? (
            <Link
              className={buttonClasses({ variant: "secondary" })}
              href={`?${params}&page=${page - 1}`}
            >
              Previous entries
            </Link>
          ) : (
            <span />
          )}
          {page * 40 < data.entries.length ? (
            <Link
              className={buttonClasses({ variant: "secondary" })}
              href={`?${params}&page=${page + 1}`}
            >
              Next entries
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
