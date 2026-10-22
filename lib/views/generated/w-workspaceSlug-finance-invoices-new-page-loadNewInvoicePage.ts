// Generated from app/w/[workspaceSlug]/finance/invoices/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";

export async function loadNewInvoicePage({ params }: PageProps<"/w/[workspaceSlug]/finance/invoices/new">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageFinance(membership)) notFound();
const href = `/w/${workspace.slug}/finance/invoices`;
return viewDto({ workspace, href } as const);
}
