import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/finance/InvoiceDocument";
import { PrintButton } from "@/components/finance/PrintButton";
import { localDate } from "@/lib/finance/dates";
import { isInvoiceOverdue, parseInvoiceItems } from "@/lib/finance/invoice";
import { getInvoice } from "@/lib/finance/queries";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";

export const metadata = { title: "Print invoice" };

/*
 * Print stylesheet: only the invoice is visible on paper, laid out from the
 * top-left of the page, in plain ink on white whatever the colour mode. The
 * browser's own "Save as PDF" covers PDFs, so the server never renders one.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 16mm; }
  html, body { background: transparent !important; }
  body * { visibility: hidden !important; }
  #invoice-print, #invoice-print * { visibility: visible !important; color: var(--sw-ink) !important; background: transparent !important; border-color: var(--sw-ink) !important; box-shadow: none !important; }
  #invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
}`;

export default async function PrintInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/[invoiceId]/print">) {
  const { workspaceSlug, invoiceId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace) || !idSchema.safeParse(invoiceId).success) notFound();
  const invoice = await getInvoice(workspace.id, invoiceId);
  if (!invoice) notFound();
  const manage = canManageFinance(membership);
  return (
    <div className="flex flex-col gap-5">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <Link href={`/w/${workspace.slug}/finance/invoices/${invoice.id}`} className="text-label text-ink-secondary underline-offset-4 hover:underline">
          ← Back to {invoice.number}
        </Link>
        <PrintButton />
      </div>
      <div id="invoice-print">
        <InvoiceDocument
          workspaceName={workspace.name}
          overdue={isInvoiceOverdue(invoice, localDate(new Date(), workspace.timezone))}
          invoice={{ ...invoice, clientEmail: manage ? invoice.clientEmail : null, items: parseInvoiceItems(invoice.items) }}
        />
      </div>
    </div>
  );
}
