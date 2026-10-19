"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/choice";
import { Dropdown, Field, Input } from "@/components/ui/field";
import type { LedgerFilters } from "@/lib/finance/filters";
import type { CategoryOption } from "@/components/finance/LedgerEntryDialog";

// Construct Field controls within one client boundary so React can inspect and
// clone each child to attach its label and error attributes.
export function LedgerFilterForm({ href, filters, categories, filtered }: { href: string; filters: LedgerFilters; categories: CategoryOption[]; filtered: boolean }) {
  return (
      <form method="get" action={href} className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end" role="search" aria-label="Filter the ledger">
        <Field label="Search">
          <Input name="q" defaultValue={filters.q ?? ""} placeholder="Description, payee or category" />
        </Field>
        <Field label="Type">
          <Dropdown name="kind" defaultValue={filters.kind?.toLowerCase() ?? ""}>
            <option value="">In and out</option>
            <option value="income">Money in</option>
            <option value="expense">Money out</option>
          </Dropdown>
        </Field>
        <Field label="Category">
          <Dropdown name="category" defaultValue={filters.categoryId ?? ""}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Field label="From">
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Field>
        <Field label="To">
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-1">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Link href={href} className="text-label text-ink-secondary underline-offset-4 hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
        <CheckboxField name="voided" value="1" defaultChecked={filters.includeVoided} label="Show voided entries" className="sm:col-span-2 lg:col-span-6" />
      </form>
  );
}
