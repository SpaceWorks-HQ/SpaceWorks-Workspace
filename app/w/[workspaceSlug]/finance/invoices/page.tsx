import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState, SectionHeading } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDay, localDate } from "@/lib/finance/dates";
import { parseLedgerFilters } from "@/lib/finance/filters";
import { INVOICE_STATUS_LABEL, INVOICE_STATUSES, isInvoiceOverdue, type InvoiceStatusValue } from "@/lib/finance/invoice";
import { INVOICE_STATUS_TONE } from "@/lib/finance/labels";
import { listInvoices } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/format/money";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/invoices">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace)) notFound();
  const query = await searchParams;
  const raw = String(query.status ?? "").toUpperCase();
  const { page } = parseLedgerFilters(query);
  const status = (INVOICE_STATUSES as readonly string[]).includes(raw) ? (raw as InvoiceStatusValue) : null;
  const { invoices, counts, pageCount } = await listInvoices(workspace.id, status, page);
  if (page > pageCount) notFound();
  const href = `/w/${workspace.slug}/finance/invoices`;
  const today = localDate(new Date(), workspace.timezone);
  const manage = canManageFinance(membership);
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  const pageHref = (n: number) => `${href}?${status ? `status=${status.toLowerCase()}&` : ""}page=${n}`;

  return (
    <div className="flex flex-col gap-5">
      <SectionHeading
        title="Invoices"
        description="Bill sponsors, clients and workshop partners. Paid invoices land on the ledger."
        action={manage ? <Button asChild variant="primary"><Link href={`${href}/new`}>New invoice</Link></Button> : null}
      />
      <NavTabs
        label="Invoice status"
        items={[
          { href, label: `All (${total})`, active: status === null },
          ...INVOICE_STATUSES.map((s) => ({ href: `${href}?status=${s.toLowerCase()}`, label: `${INVOICE_STATUS_LABEL[s]} (${counts[s] ?? 0})`, active: status === s })),
        ]}
      />
      {invoices.length === 0 ? (
        <EmptyState
          mood="sleepy"
          title={status ? `No ${INVOICE_STATUS_LABEL[status].toLowerCase()} invoices.` : "No invoices yet."}
          action={manage && !status ? <Button asChild variant="primary"><Link href={`${href}/new`}>Write the first invoice</Link></Button> : null}
        >
          {status ? "Pick another status above." : manage ? "Bill a sponsor or a workshop partner." : "Admins haven't written any invoices yet."}
        </EmptyState>
      ) : (
        <Table label="Invoices">
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Client</TH>
              <TH>Issued</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH className="text-right">Total</TH>
            </TR>
          </THead>
          <TBody>
            {invoices.map((invoice) => {
              const overdue = isInvoiceOverdue(invoice, today);
              return (
                <TR key={invoice.id}>
                  <TD className="whitespace-nowrap font-medium tabular-nums">
                    <Link href={`${href}/${invoice.id}`} className="text-accent-text underline-offset-4 hover:underline">
                      {invoice.number}
                    </Link>
                  </TD>
                  <TD>{invoice.clientName}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-ink-secondary">{formatDay(invoice.issuedOn)}</TD>
                  <TD className="whitespace-nowrap tabular-nums text-ink-secondary">{invoice.dueOn ? formatDay(invoice.dueOn) : "—"}</TD>
                  <TD>
                    <Chip tone={overdue ? "danger" : INVOICE_STATUS_TONE[invoice.status]}>{overdue ? "Overdue" : INVOICE_STATUS_LABEL[invoice.status]}</Chip>
                  </TD>
                  <TD className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(invoice.totalMinor, invoice.currency)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {pageCount > 1 ? (
        <nav aria-label="Invoice pages" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-caption text-ink-muted">Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild variant="secondary"><Link href={pageHref(page - 1)}>Newer</Link></Button> : null}
            {page < pageCount ? <Button asChild variant="secondary"><Link href={pageHref(page + 1)}>Older</Link></Button> : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
