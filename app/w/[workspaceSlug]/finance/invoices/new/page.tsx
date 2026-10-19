import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceForm } from "@/components/finance/InvoiceForm";
import { SectionHeading } from "@/components/ui/display";
import { localDate } from "@/lib/finance/dates";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/new">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageFinance(membership)) notFound();
  const href = `/w/${workspace.slug}/finance/invoices`;
  return (
    <div className="flex flex-col gap-5">
      <Link href={href} className="text-label text-ink-secondary underline-offset-4 hover:underline">
        ← Back to invoices
      </Link>
      <SectionHeading title="New invoice" description={`Numbered automatically when you save. Amounts in ${workspace.currency}.`} />
      <InvoiceForm
        slug={workspace.slug}
        currency={workspace.currency}
        backHref={href}
        initial={{
          clientName: "",
          clientEmail: "",
          issuedOn: localDate(new Date(), workspace.timezone),
          dueOn: "",
          notes: "",
          lines: [{ key: "line-0", description: "", quantity: "1", unitPrice: "", tax: "" }],
        }}
      />
    </div>
  );
}
