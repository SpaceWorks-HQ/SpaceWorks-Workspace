// Generated from app/w/[workspaceSlug]/finance/ledger/import/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";

export async function loadImportLedgerPage({ params }: PageProps<"/w/[workspaceSlug]/finance/ledger/import">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageFinance(membership)) notFound();
const ledgerHref = `/w/${workspace.slug}/finance/ledger`;
return viewDto({ workspace, ledgerHref } as const);
}
