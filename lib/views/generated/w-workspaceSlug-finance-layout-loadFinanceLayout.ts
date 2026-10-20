// Generated from app/w/[workspaceSlug]/finance/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadFinanceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/finance">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace)) notFound();
return viewDto({ workspace, membership } as const);
}
