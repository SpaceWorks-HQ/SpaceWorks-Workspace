// Generated from app/w/[workspaceSlug]/finance/invoices/[invoiceId]/print/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/finance/queries";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
const PRINT_CSS = `
@media print {
  @page { margin: 16mm; }
  html, body { background: transparent !important; }
  body * { visibility: hidden !important; }
  #invoice-print, #invoice-print * { visibility: visible !important; color: var(--sw-ink) !important; background: transparent !important; border-color: var(--sw-ink) !important; box-shadow: none !important; }
  #invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
}`;
export async function loadPrintInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/[invoiceId]/print">) {
const { workspaceSlug, invoiceId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace) || !idSchema.safeParse(invoiceId).success) notFound();
const invoice = await getInvoice(workspace.id, invoiceId);
if (!invoice) notFound();
const manage = canManageFinance(membership);
return viewDto({ workspace, invoice, manage } as const);
}
