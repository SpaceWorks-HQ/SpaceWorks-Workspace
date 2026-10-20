"use client";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
export function FinanceFilters({
  query,
  month = false,
  period = false,
  centres = [],
  statuses = [],
  currency,
}: {
  query: FinanceQuery;
  month?: boolean;
  period?: boolean;
  centres?: Array<{ id: string; name: string }>;
  statuses?: Array<{ id: string; name: string }>;
  currency?: string;
}) {
  return (
    <form
      method="get"
      className="grid grid-cols-1 items-end gap-3 rounded-xl border border-line bg-panel p-4 print:hidden sm:grid-cols-2 lg:grid-cols-4"
    >
      {month ? (
        <Field label="Month">
          <Input
            type="month"
            name="month"
            defaultValue={query.month}
            min="2000-01"
            max="2099-12"
          />
        </Field>
      ) : null}
      {period ? (
        <>
          <Field label="From">
            <Input type="date" name="from" defaultValue={query.from} />
          </Field>
          <Field label="To">
            <Input type="date" name="to" defaultValue={query.to} />
          </Field>
        </>
      ) : null}
      {currency ? (
        <Field label="Currency">
          <Input
            name="currency"
            defaultValue={query.currency ?? currency}
            maxLength={3}
          />
        </Field>
      ) : null}
      {centres.length ? (
        <Field label="Cost centre">
          <Dropdown name="centre" defaultValue={query.centre ?? ""}>
            <option value="">All cost centres</option>
            {centres.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </Dropdown>
        </Field>
      ) : null}
      {statuses.length ? (
        <Field label="Status">
          <Dropdown name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Dropdown>
        </Field>
      ) : null}
      <Field label="Search">
        <Input name="q" type="search" maxLength={120} defaultValue={query.q} />
      </Field>
      <div>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </div>
    </form>
  );
}
