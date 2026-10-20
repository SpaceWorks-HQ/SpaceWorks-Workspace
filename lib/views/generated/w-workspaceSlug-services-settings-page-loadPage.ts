// Generated from app/w/[workspaceSlug]/services/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/settings">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageServices(membership)) notFound();
const entries = await prisma.monitorNetworkAllowlist.findMany({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "desc" } });
return viewDto({ workspace, entries } as const);
}
