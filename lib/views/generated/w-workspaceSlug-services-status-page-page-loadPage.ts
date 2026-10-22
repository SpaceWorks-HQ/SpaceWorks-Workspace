// Generated from app/w/[workspaceSlug]/services/status-page/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/status-page">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageServices(membership)) notFound();
const [page, monitors] = await Promise.all([prisma.statusPage.findUnique({ where: { workspaceId: workspace.id }, include: { components: { orderBy: { sortOrder: "asc" } } } }), prisma.monitor.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
return viewDto({ workspace, page, monitors } as const);
}
