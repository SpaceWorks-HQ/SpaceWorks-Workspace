import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { InvoiceForm } from "@/components/finance/InvoiceForm";
import { SectionHeading } from "@/components/ui/display";
import { isoDay } from "@/lib/finance/dates";
import { isEditableInvoice, parseInvoiceItems } from "@/lib/finance/invoice";
import { minorToDecimalString } from "@/lib/finance/money";
import { getInvoice } from "@/lib/finance/queries";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/[invoiceId]/edit">) {
  const { workspaceSlug, invoiceId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageFinance(membership) || !idSchema.safeParse(invoiceId).success) notFound();
  const invoice = await getInvoice(workspace.id, invoiceId);
  if (!invoice) notFound();
  const href = `/w/${workspace.slug}/finance/invoices`;
  if (!isEditableInvoice(invoice.status)) redirect(`${href}/${invoice.id}`);
  return (
    <div className="flex flex-col gap-5">
      <Link href={`${href}/${invoice.id}`} className="text-label text-ink-secondary underline-offset-4 hover:underline">
        ← Back to {invoice.number}
      </Link>
      <SectionHeading title={`Edit ${invoice.number}`} description={invoice.status === "SENT" ? "It was already sent. Email it again after you save if the client needs the new version." : undefined} />
      <InvoiceForm
        slug={workspace.slug}
        currency={invoice.currency}
        invoiceId={invoice.id}
        backHref={href}
        initial={{
          clientName: invoice.clientName,
          clientEmail: invoice.clientEmail ?? "",
          issuedOn: isoDay(invoice.issuedOn),
          dueOn: invoice.dueOn ? isoDay(invoice.dueOn) : "",
          notes: invoice.notes ?? "",
          lines: parseInvoiceItems(invoice.items).map((item, index) => ({
            key: `line-${index}`,
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: minorToDecimalString(item.unitMinor, invoice.currency),
            tax: item.taxBps ? String(item.taxBps / 100) : "",
          })),
        }}
      />
    </div>
  );
}
