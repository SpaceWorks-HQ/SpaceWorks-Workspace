import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { costKinds } from "@/lib/finance/recurring/rules";
import { label } from "@/lib/finance/tools-rules";
import type { ScheduleView, RecurringQuery } from "@/lib/finance/recurring/queries";

export function CostNav({
  slug,
  finance = true,
  payroll = false,
}: {
  slug: string;
  finance?: boolean;
  payroll?: boolean;
}) {
  const items = [
    ...(finance
      ? [
          { path: "recurring", label: "Recurring costs" },
          { path: "dues", label: "Upcoming dues" },
        ]
      : []),
    { path: "advances", label: "Staff advances" },
    ...(payroll ? [{ path: "payroll/dues", label: "Payroll dues" }] : []),
  ];
  return (
    <nav aria-label="Recurring finance tools" className="flex flex-wrap gap-3">
      {items.map((item) => (
        <Link
          key={item.path}
          className={buttonClasses({ variant: "quiet" })}
          href={`/w/${slug}/finance/${item.path}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
export function Filters({
  view,
  query,
  dues = false,
}: {
  view: Pick<ScheduleView, "pickers">;
  query: RecurringQuery;
  dues?: boolean;
}) {
  return (
    <form className="grid min-w-0 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="Search">
        <Input name="q" defaultValue={query.q} maxLength={120} />
      </Field>
      <Field label="Type">
        <Dropdown name="kind" defaultValue={query.kind ?? ""}>
          <option value="">All types</option>
          {[
            ...costKinds,
            ...(dues
              ? ["BILL", "PF", "ESI", "PT", "SALARY_TDS", "ADVANCE_RECOVERY"]
              : []),
          ].map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </Dropdown>
      </Field>
      <Field label="Fund">
        <Dropdown name="fund" defaultValue={query.fund ?? ""}>
          <option value="">All funds</option>
          {view.pickers.funds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Dropdown>
      </Field>
      <Field label="Cost centre">
        <Dropdown name="centre" defaultValue={query.centre ?? ""}>
          <option value="">All cost centres</option>
          {view.pickers.centres.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Dropdown>
      </Field>
      {dues ? (
        <Field label="Window">
          <Dropdown name="days" defaultValue={query.days ?? "30"}>
            {[30, 60, 90].map((n) => (
              <option key={n} value={n}>
                Next {n} days
              </option>
            ))}
          </Dropdown>
        </Field>
      ) : (
        <Field label="Status">
          <Dropdown name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            {["ACTIVE", "PAUSED", "ENDED"].map((n) => (
              <option key={n} value={n}>
                {label(n)}
              </option>
            ))}
          </Dropdown>
        </Field>
      )}
      <button className={buttonClasses({ variant: "secondary" })}>
        Apply filters
      </button>
      {dues ? (
        <>
          <Field label="Payment status">
            <Dropdown name="status" defaultValue={query.status ?? ""}>
              <option value="">Outstanding</option>
              <option value="paid">Paid</option>
            </Dropdown>
          </Field>
          <Field label="Currency">
            <Input
              name="currency"
              maxLength={3}
              defaultValue={query.currency}
              placeholder="All currencies"
            />
          </Field>
        </>
      ) : null}
    </form>
  );
}
export function PageLinks({
  base,
  query,
  page,
  total,
}: {
  base: string;
  query: RecurringQuery;
  page: number;
  total: number;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p>
        {total} records · Page {page}
      </p>
      {page > 1 ? (
        <Link
          className={buttonClasses({ variant: "quiet" })}
          href={`${base}?${new URLSearchParams({ ...query, page: String(page - 1) })}`}
        >
          Previous
        </Link>
      ) : null}
      {page * 40 < total ? (
        <Link
          className={buttonClasses({ variant: "quiet" })}
          href={`${base}?${new URLSearchParams({ ...query, page: String(page + 1) })}`}
        >
          Next
        </Link>
      ) : null}
    </nav>
  );
}
