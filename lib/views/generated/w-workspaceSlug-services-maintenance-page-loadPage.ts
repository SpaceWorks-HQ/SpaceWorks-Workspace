// Generated from app/w/[workspaceSlug]/services/maintenance/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/maintenance">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
const manage = canManageServices(membership);
const [windows, monitors] = await Promise.all([prisma.maintenanceWindow.findMany({ where: { workspaceId: workspace.id }, orderBy: { startsAt: "desc" }, take: 100 }), prisma.monitor.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } })]);
return viewDto({ workspace, membership, manage, windows, monitors } as const);
}
