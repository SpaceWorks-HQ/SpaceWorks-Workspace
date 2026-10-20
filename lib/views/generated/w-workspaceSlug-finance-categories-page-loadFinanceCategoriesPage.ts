// Generated from app/w/[workspaceSlug]/finance/categories/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { listCategories } from "@/lib/finance/queries";
import { canManageFinance, requireWorkspace } from "@/lib/permissions";

export async function loadFinanceCategoriesPage({ params }: PageProps<"/w/[workspaceSlug]/finance/categories">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageFinance(membership)) notFound();
const categories = await listCategories(workspace.id, { includeArchived: true });
return viewDto({ workspace, categories } as const);
}
