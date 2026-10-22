import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import type { UpcomingView, RecurringQuery } from "@/lib/finance/recurring/queries";
import { CostNav, Filters, PageLinks } from "./Navigation";
import { DueRow } from "./DueRow";

export function DuesScreen({
  slug,
  view,
  query,
}: {
  slug: string;
  view: UpcomingView;
  query: RecurringQuery;
}) {
  const base = `/w/${slug}/finance`,
    pageBase = `${base}/${view.payrollOnly ? "payroll/dues" : "dues"}`;
  return (
    <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader titleAs="h2"
        title={
          view.payrollOnly
            ? "Payroll remittances and recoveries"
            : "Upcoming dues"
        }
        description="Overdue first, then the next 30, 60 or 90 days. Future schedules appear as projections until their bill is created."
      />
      <CostNav
        slug={slug}
        finance={view.financeManage}
        payroll={view.payrollOnly || view.payrollManage}
      />
      <Filters view={view} query={query} dues />
      <a
        className="min-h-11 py-3 text-accent-text underline"
        href={`${base}/recurring/export?${new URLSearchParams({ ...query, export: view.payrollOnly ? "payroll" : "dues" })}`}
      >
        Export dues CSV
      </a>
      {view.payrollOnly ? (
        <p className="text-sm text-ink-secondary">
          PF / ESI default to the 15th, salary withholding to the 7th of the
          next month. PT defaults to the 15th. Review local applicability and
          change each unpaid due date as needed.
        </p>
      ) : null}
      {view.rows.length ? (
        <ul className="space-y-4">
          {view.rows.map((r) => (
            <DueRow key={r.id} slug={slug} view={view} r={r} />
          ))}
        </ul>
      ) : (
        <EmptyState
          patch="idle"
          title="No dues in this window."
          action={
            <Link
              className={buttonClasses({ variant: "primary" })}
              href={`${base}/recurring`}
            >
              Review schedules
            </Link>
          }
        />
      )}
      <PageLinks
        base={pageBase}
        query={query}
        page={view.page}
        total={view.total}
      />
    </div>
  );
}
