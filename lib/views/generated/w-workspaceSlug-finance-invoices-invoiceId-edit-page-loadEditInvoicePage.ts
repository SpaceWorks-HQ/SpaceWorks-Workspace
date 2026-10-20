// Generated from app/w/[workspaceSlug]/finance/invoices/[invoiceId]/edit/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound, redirect } from "next/navigation";
import { isEditableInvoice } from "@/lib/finance/invoice";
import { getInvoice } from "@/lib/finance/queries";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";

export async function loadEditInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/[invoiceId]/edit">) {
const { workspaceSlug, invoiceId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageFinance(membership) || !idSchema.safeParse(invoiceId).success) notFound();
const invoice = await getInvoice(workspace.id, invoiceId);
if (!invoice) notFound();
const href = `/w/${workspace.slug}/finance/invoices`;
if (!isEditableInvoice(invoice.status)) redirect(`${href}/${invoice.id}`);
return viewDto({ workspace, invoice, href } as const);
}
