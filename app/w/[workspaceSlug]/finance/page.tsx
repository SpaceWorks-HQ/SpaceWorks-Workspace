import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthlyChart } from "@/components/finance/MonthlyChart";
import { CategoryBars } from "@/components/finance/CategoryBars";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader, Chip, EmptyState, ProgressBar, StatTile } from "@/components/ui/display";
import { formatDay } from "@/lib/finance/dates";
import { getFinanceSummary } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/format/money";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Finance" };

export default async function FinanceOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/finance">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace)) notFound();
  const summary = await getFinanceSummary(workspace);
  const base = `/w/${workspace.slug}/finance`;
  const money = (minor: number) => formatMoney(minor, workspace.currency);
  const manage = canManageFinance(membership);
  const hasHistory = summary.series.some((m) => m.incomeMinor || m.expenseMinor) || summary.recent.length > 0 || summary.outstanding.count > 0 || summary.budgets.length > 0;

  if (!hasHistory) {
    return (
      <EmptyState patch
        mood="sleepy"
        title="The kitty is empty so far."
        action={manage ? <Button asChild variant="primary"><Link href={`${base}/ledger?new=1`}>Record the first entry</Link></Button> : null}
      >
        {manage ? "Record money in and out, or import last year's sheet." : "Admins haven't recorded anything yet."}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Balance" value={money(summary.balanceMinor)} hint="Everything in the kitty" href={`${base}/ledger`} />
        <StatTile label="In this month" value={money(summary.thisMonth.incomeMinor)} hint={summary.thisMonth.label} />
        <StatTile label="Out this month" value={money(summary.thisMonth.expenseMinor)} hint={summary.thisMonth.label} />
        <StatTile
          label="Waiting on invoices"
          value={money(summary.outstanding.totalMinor)}
          hint={summary.outstanding.count === 1 ? "1 invoice sent" : `${summary.outstanding.count} invoices sent`}
          href={`${base}/invoices?status=sent`}
        />
      </div>

      {summary.otherCurrencies > 0 ? (
        <Callout tone="info" title={`${summary.otherCurrencies} ${summary.otherCurrencies === 1 ? "entry is" : "entries are"} in another currency.`}>
          They are listed in the ledger but not counted in these totals, which are in {workspace.currency}.
        </Callout>
      ) : null}

      <Card as="section" aria-labelledby="fin-monthly">
        <CardHeader title={<span id="fin-monthly">Money in and out</span>} description="The last 12 months, voided entries left out." />
        <MonthlyChart data={summary.series} currency={workspace.currency} />
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card as="section">
          <CardHeader title="Where the money went" description="Top expense categories, last 90 days." />
          {summary.topCategories.length ? (
            <CategoryBars items={summary.topCategories.map((c) => ({ label: c.name, value: c.amountMinor, display: money(c.amountMinor), href: c.id ? `${base}/ledger?kind=expense&category=${c.id}` : undefined }))} />
          ) : (
            <p className="text-body-ui text-ink-muted">No expenses in the last 90 days.</p>
          )}
        </Card>

        {summary.budgets.length ? (
          <Card as="section">
            <CardHeader title="Budgets" description="Spent so far against each running budget." />
            <ul className="flex flex-col gap-4">
              {summary.budgets.map((budget) => {
                const over = budget.spentMinor > budget.amountMinor;
                return (
                  <li key={budget.id} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-title text-ink">{budget.name}</span>
                      <span className="text-body-ui tabular-nums text-ink-secondary">
                        {formatMoney(budget.spentMinor, budget.currency)} of {formatMoney(budget.amountMinor, budget.currency)}
                      </span>
                    </div>
                    <ProgressBar value={budget.spentMinor} max={budget.amountMinor} tone={over ? "warning" : "accent"} label={`${budget.name} budget used`} />
                    <span className="flex items-center gap-2 text-caption text-ink-muted">
                      Until {formatDay(budget.periodEnd)}
                      {over ? <Chip tone="warning" size="sm">Over budget</Chip> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <Card as="section">
            <CardHeader title="Latest entries" action={<Link href={`${base}/ledger`} className="text-label text-accent-text underline-offset-4 hover:underline">Open the ledger</Link>} />
            <ul className="flex flex-col divide-y divide-line">
              {summary.recent.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-body-ui text-ink">{entry.description}</p>
                    <p className="text-caption text-ink-muted">
                      {formatDay(entry.occurredOn)}
                      {entry.category ? ` · ${entry.category.name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-body-ui font-semibold tabular-nums text-ink">
                    {entry.kind === "INCOME" ? "+" : "−"}
                    {formatMoney(entry.amountMinor, entry.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
