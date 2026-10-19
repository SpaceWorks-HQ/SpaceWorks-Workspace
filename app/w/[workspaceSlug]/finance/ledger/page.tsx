import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { LedgerRowActions, LedgerToolbar } from "@/components/finance/LedgerControls";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, SectionHeading } from "@/components/ui/display";
import { CheckboxField } from "@/components/ui/choice";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDay, isoDay, localDate } from "@/lib/finance/dates";
import { hasActiveFilters, ledgerFiltersToQuery, parseLedgerFilters } from "@/lib/finance/filters";
import { sourceHref, sourceLabel } from "@/lib/finance/labels";
import { minorToDecimalString } from "@/lib/finance/money";
import { listBudgetOptions, listCategories, listLedger } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/format/money";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Ledger" };

export default async function LedgerPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/ledger">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace)) notFound();
  const query = await searchParams;
  const filters = parseLedgerFilters(query);
  const manage = canManageFinance(membership);
  const [ledger, categories, budgets] = await Promise.all([
    listLedger(workspace, filters),
    listCategories(workspace.id, { includeArchived: true }),
    manage ? listBudgetOptions(workspace.id) : Promise.resolve([]),
  ]);
  const base = `/w/${workspace.slug}`;
  const ledgerHref = `${base}/finance/ledger`;
  const money = (minor: number, currency = workspace.currency) => formatMoney(minor, currency);
  const shared = {
    slug: workspace.slug,
    currency: workspace.currency,
    today: localDate(new Date(), workspace.timezone),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archived })),
    budgets: budgets.map((b) => ({ id: b.id, name: b.name })),
  };
  const filtered = hasActiveFilters(filters);
  const { page: _page, ...withoutPage } = filters;
  void _page;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        title="Ledger"
        description="Every entry in the kitty, newest first."
        action={
          <LedgerToolbar
            shared={shared}
            exportHref={`${ledgerHref}/export${ledgerFiltersToQuery(withoutPage)}`}
            importHref={manage ? `${ledgerHref}/import` : null}
            startOpen={manage && query.new === "1"}
          />
        }
      />

      <form method="get" action={ledgerHref} className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto] lg:items-end" role="search" aria-label="Filter the ledger">
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
            <Link href={ledgerHref} className="text-label text-ink-secondary underline-offset-4 hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
        <CheckboxField name="voided" value="1" defaultChecked={filters.includeVoided} label="Show voided entries" className="sm:col-span-2 lg:col-span-6" />
      </form>

      <dl className="grid gap-3 sm:grid-cols-3" aria-label={filtered ? "Totals for these filters" : "Totals"}>
        <div className="rounded-xl border border-line bg-panel px-4 py-3">
          <dt className="text-caption text-ink-muted">Money in</dt>
          <dd className="text-h4 tabular-nums text-ink">{money(ledger.totals.incomeMinor)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-panel px-4 py-3">
          <dt className="text-caption text-ink-muted">Money out</dt>
          <dd className="text-h4 tabular-nums text-ink">{money(ledger.totals.expenseMinor)}</dd>
        </div>
        <div className="rounded-xl border border-line bg-panel px-4 py-3">
          <dt className="text-caption text-ink-muted">{filtered ? "Net for these filters" : "Balance"}</dt>
          <dd className="text-h4 tabular-nums text-ink">{money(ledger.totals.netMinor)}</dd>
        </div>
      </dl>

      {ledger.rows.length === 0 ? (
        <EmptyState
          mood="sleepy"
          title={filtered ? "Nothing matches these filters." : "No entries yet."}
          action={filtered ? <Button asChild variant="secondary"><Link href={ledgerHref}>Clear filters</Link></Button> : null}
        >
          {filtered ? "Try a wider date range or another category." : manage ? "Record money in or out, or import a CSV." : "Admins haven't recorded anything yet."}
        </EmptyState>
      ) : (
        <Table label="Ledger entries">
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH>Category</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Balance</TH>
              {manage ? <TH><span className="sr-only">Actions</span></TH> : null}
            </TR>
          </THead>
          <TBody>
            {ledger.rows.map((row) => {
              const voided = Boolean(row.voidedAt);
              const linked = sourceLabel(row.sourceType);
              const linkHref = sourceHref(base, row.sourceType, row.sourceId);
              return (
                <TR key={row.id} className={voided ? "text-ink-muted" : undefined}>
                  <TD className="whitespace-nowrap tabular-nums text-ink-secondary">{formatDay(row.occurredOn)}</TD>
                  <TD className="min-w-56">
                    <span className={voided ? "text-ink-muted line-through" : "text-ink"}>{row.description}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
                      {row.counterparty ? <span>{row.counterparty}</span> : null}
                      {voided ? <Chip size="sm" tone="outline">Void</Chip> : null}
                      {linked ? (
                        linkHref ? (
                          <Link href={linkHref} className="underline underline-offset-4">
                            <Chip size="sm" tone="accent">{linked.replace("Posted from ", "From ")}</Chip>
                          </Link>
                        ) : (
                          <Chip size="sm" tone="accent">{linked.replace("Posted from ", "From ")}</Chip>
                        )
                      ) : null}
                      {row.budget ? <span>Budget: {row.budget.name}</span> : null}
                      {row.receiptFileId ? (
                        <a href={`/api/files/${row.receiptFileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text underline underline-offset-4">
                          <Paperclip aria-hidden className="size-3.5" />
                          Receipt
                        </a>
                      ) : null}
                    </span>
                  </TD>
                  <TD className="text-ink-secondary">{row.category?.name ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    <span className="sr-only">{row.kind === "INCOME" ? "Money in " : "Money out "}</span>
                    <span className={voided ? "line-through" : "font-semibold"}>
                      {row.kind === "INCOME" ? "+" : "−"}
                      {money(row.amountMinor, row.currency)}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums text-ink-secondary">{row.balanceMinor === null ? "—" : money(row.balanceMinor)}</TD>
                  {manage ? (
                    <TD className="w-12 text-right">
                      <LedgerRowActions
                        shared={shared}
                        voided={voided}
                        entry={{
                          id: row.id,
                          kind: row.kind,
                          amount: minorToDecimalString(row.amountMinor, row.currency),
                          occurredOn: isoDay(row.occurredOn),
                          description: row.description,
                          counterparty: row.counterparty ?? "",
                          categoryId: row.category?.id ?? "",
                          budgetId: row.budget?.id ?? "",
                          receiptFileId: row.receiptFileId,
                          receiptName: row.receiptName,
                          linkedLabel: linked,
                        }}
                      />
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {ledger.pageCount > 1 ? (
        <nav aria-label="Ledger pages" className="flex items-center justify-between gap-3">
          <span className="text-caption text-ink-muted">
            Page {filters.page} of {ledger.pageCount} · {ledger.total} entries
          </span>
          <div className="flex gap-2">
            {filters.page > 1 ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${ledgerHref}${ledgerFiltersToQuery({ ...filters, page: filters.page - 1 })}`}>Newer</Link>
              </Button>
            ) : null}
            {filters.page < ledger.pageCount ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${ledgerHref}${ledgerFiltersToQuery({ ...filters, page: filters.page + 1 })}`}>Older</Link>
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
