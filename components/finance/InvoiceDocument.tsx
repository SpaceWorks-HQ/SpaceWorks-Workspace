import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Chip } from "@/components/ui/display";
import { formatDay } from "@/lib/finance/dates";
import { INVOICE_STATUS_LABEL, type InvoiceStatusValue } from "@/lib/finance/invoice";
import { INVOICE_STATUS_TONE } from "@/lib/finance/labels";
import { formatBps, invoiceTotals, lineSubtotalMinor, lineTaxMinor, type InvoiceItem } from "@/lib/finance/money";
import { formatMoney } from "@/lib/format/money";

export type InvoiceDocumentData = {
  number: string;
  status: InvoiceStatusValue;
  clientName: string;
  clientEmail: string | null;
  issuedOn: Date;
  dueOn: Date | null;
  paidAt: Date | null;
  currency: string;
  items: InvoiceItem[];
  notes: string | null;
};

/**
 * The invoice itself: used on the detail page and the print page. Print CSS
 * (see the print page) hides everything else, so this block is the paper.
 */
export function InvoiceDocument({ invoice, workspaceName, overdue }: { invoice: InvoiceDocumentData; workspaceName: string; overdue?: boolean }) {
  const totals = invoiceTotals(invoice.items);
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const anyTax = invoice.items.some((item) => item.taxBps);
  return (
    <article id="invoice-document" className="rounded-xl border border-line bg-panel p-6 text-ink sm:p-10 print:rounded-none print:border-0 print:p-0">
      <header className="flex flex-col gap-6 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-overline text-ink-muted">Invoice</p>
          <h2 className="mt-1 text-h2 tabular-nums">{invoice.number}</h2>
          <p className="mt-1 text-body-ui text-ink-secondary">From {workspaceName}</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="print:hidden">
            <Chip tone={overdue ? "danger" : INVOICE_STATUS_TONE[invoice.status]}>{overdue ? "Overdue" : INVOICE_STATUS_LABEL[invoice.status]}</Chip>
          </span>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-body-ui">
            <dt className="text-ink-muted">Issued</dt>
            <dd className="tabular-nums">{formatDay(invoice.issuedOn)}</dd>
            {invoice.dueOn ? (
              <>
                <dt className="text-ink-muted">Due</dt>
                <dd className="tabular-nums">{formatDay(invoice.dueOn)}</dd>
              </>
            ) : null}
            {invoice.status === "PAID" && invoice.paidAt ? (
              <>
                <dt className="text-ink-muted">Paid</dt>
                <dd className="tabular-nums">{formatDay(invoice.paidAt)}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </header>

      <section className="border-b border-line py-6" aria-label="Billed to">
        <p className="text-overline text-ink-muted">Billed to</p>
        <p className="mt-1 text-title">{invoice.clientName}</p>
        {invoice.clientEmail ? <p className="text-body-ui text-ink-secondary">{invoice.clientEmail}</p> : null}
      </section>

      <div className="overflow-x-auto py-6">
        <Table className="w-full min-w-[480px] border-collapse text-left text-body-ui">
          <THead>
            <TR className="border-b border-line text-sm text-ink-muted">
              <TH scope="col" className="py-2 pr-4 font-semibold">Item</TH>
              <TH scope="col" className="py-2 pr-4 text-right font-semibold">Qty</TH>
              <TH scope="col" className="py-2 pr-4 text-right font-semibold">Unit price</TH>
              {anyTax ? <TH scope="col" className="py-2 pr-4 text-right font-semibold">Tax</TH> : null}
              <TH scope="col" className="py-2 text-right font-semibold">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {invoice.items.map((item, index) => (
              <TR key={index} className="border-b border-line align-top">
                <TD className="py-3 pr-4">{item.description}</TD>
                <TD className="py-3 pr-4 text-right tabular-nums">{item.quantity}</TD>
                <TD className="py-3 pr-4 text-right tabular-nums">{money(item.unitMinor)}</TD>
                {anyTax ? <TD className="py-3 pr-4 text-right tabular-nums">{item.taxBps ? `${money(lineTaxMinor(item))} (${formatBps(item.taxBps)})` : "—"}</TD> : null}
                <TD className="py-3 text-right tabular-nums">{money(lineSubtotalMinor(item))}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <dl className="ml-auto mt-4 grid max-w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-body-ui">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="text-right tabular-nums">{money(totals.subtotalMinor)}</dd>
          {anyTax ? (
            <>
              <dt className="text-ink-muted">Tax</dt>
              <dd className="text-right tabular-nums">{money(totals.taxMinor)}</dd>
            </>
          ) : null}
          <dt className="border-t border-line pt-2 font-semibold">Total</dt>
          <dd className="border-t border-line pt-2 text-right text-h4 tabular-nums">{money(totals.totalMinor)}</dd>
        </dl>
      </div>

      {invoice.notes ? (
        <section className="border-t border-line pt-6" aria-label="Notes">
          <p className="text-overline text-ink-muted">Notes</p>
          <p className="mt-1 whitespace-pre-line text-body-ui text-ink-secondary">{invoice.notes}</p>
        </section>
      ) : null}
    </article>
  );
}
