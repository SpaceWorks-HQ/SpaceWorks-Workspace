import Link from "next/link";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { FinanceAttachments } from "@/components/finance/FinanceAttachments";
import { RecurringForm } from "./Forms";
import { label } from "@/lib/finance/tools-rules";
import { formatMoney } from "@/lib/format/money";
import type { ScheduleView, RecurringQuery } from "@/lib/finance/recurring/queries";
import { hidden, select, pretty } from "./Fields";
import { CostNav, Filters, PageLinks } from "./Navigation";
import { scheduleFields } from "./ScheduleFields";

export function ScheduleScreen({
  slug,
  view,
  query,
}: {
  slug: string;
  view: ScheduleView;
  query: RecurringQuery;
}) {
  const s = view.selected;
  const base = `/w/${slug}/finance`;
  const { fields, advanced } = scheduleFields(view);
  return (
    <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader titleAs="h2"
        title="Recurring costs"
        description="Rent, utilities and other regular dues. Each payment goes through Finance bills."
      />
      <CostNav slug={slug} payroll={view.payrollView} />
      <Filters view={view} query={query} />
      <a
        className="min-h-11 py-3 text-accent-text underline"
        href={`${base}/recurring/export?${new URLSearchParams({ ...query, kind: query.kind ?? "", export: "schedules" })}`}
      >
        Export schedules CSV
      </a>
      <Card>
        <h2 className="mb-3 text-xl font-semibold">Fixed monthly cash burn</h2>
        <p className="mb-4 text-sm text-ink-secondary">
          Active fixed schedules in these filters, including entered GST and
          withholding. Estimates are excluded. Each currency stays separate.
        </p>
        <ul className="divide-y divide-line">
          {view.burn.map((b, i) => (
            <li className="flex flex-wrap justify-between gap-3 py-3" key={i}>
              <span>
                {view.pickers.funds.find((f) => f.id === b.fundId)?.name ??
                  "No fund"}{" "}
                ·{" "}
                {view.pickers.centres.find((c) => c.id === b.costCentreId)
                  ?.name ?? "No cost centre"}
              </span>
              <strong>{formatMoney(b.amountMinor, b.currency)}</strong>
            </li>
          ))}
        </ul>
      </Card>
      {view.schedules.length ? (
        <ul className="space-y-3">
          {view.schedules.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    className="min-h-11 break-words py-2 text-lg font-semibold text-accent-text underline"
                    href={`${base}/recurring?edit=${r.id}`}
                  >
                    {r.title}
                  </Link>
                  <Chip>{label(r.status)}</Chip>
                </div>
                <p>
                  {r.payee} · {label(r.kind)} ·{" "}
                  {formatMoney(r.amountMinor, r.currency)}{" "}
                  {label(r.frequency).toLowerCase()}
                  {r.estimated ? " (estimate)" : ""}
                </p>
                <p className="mt-2 text-sm text-ink-secondary">
                  Monthly base equivalent{" "}
                  {formatMoney(r.monthlyMinor, r.currency)} · Next due{" "}
                  {pretty(r.nextDueOn)} · {r.overdue} overdue
                </p>
                {r.kind === "EMI" ? (
                  <p className="mt-2 text-sm">
                    Outstanding principal{" "}
                    {formatMoney(r.outstandingPrincipalMinor, r.currency)} ·{" "}
                    {r.tenure} instalments · {r.annualRatePercent}% entered rate
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          patch="idle"
          title="No recurring costs yet."
          action={
            <Link
              className={buttonClasses({ variant: "primary" })}
              href="#schedule-form"
            >
              Add a schedule
            </Link>
          }
        />
      )}
      <PageLinks
        base={`${base}/recurring`}
        query={query}
        page={view.page}
        total={view.total}
      />
      <Card id="schedule-form">
        <h2 className="mb-4 text-xl font-semibold">
          {s ? "Edit schedule" : "Add a schedule"}
        </h2>
        <p className="mb-4 text-sm text-ink-secondary">
          Changes apply to future bills. Existing dues keep their amounts. Tax
          rates and deadlines are manually reviewed facts.
        </p>
        <RecurringForm
          key={s?.id ?? "new"}
          slug={slug}
          operation="schedule"
          fields={fields}
          advanced={advanced}
          button="Save schedule"
        />
        {s ? (
          <div className="mt-5">
            <FinanceAttachments
              key={s.id}
              slug={slug}
              type="RECURRING"
              recordId={s.id}
              initial={view.files[s.id] ?? []}
            />
          </div>
        ) : null}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          Create from an existing record
        </h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {(
            [
              ["LEASE", view.leases, "Lease"],
              ["INSURANCE", view.insurance, "Insurance"],
              ["SUBSCRIPTION", view.subscriptions, "Subscription"],
            ] as const
          ).map(([source, choices, name]) => (
            <RecurringForm
              key={source}
              slug={slug}
              operation="source"
              fields={[
                hidden("source", source),
                select("sourceId", name, choices, "", true),
              ]}
              button={`Use ${name.toLowerCase()}`}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
