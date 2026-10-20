// Generated from app/w/[workspaceSlug]/services/incidents/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services/incidents">) {
const { workspaceSlug } = await params, query = await searchParams;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
const manage = canManageServices(membership);
const [incidents, monitors] = await Promise.all([prisma.incident.findMany({ where: { workspaceId: workspace.id, status: query.status === "resolved" ? "RESOLVED" : { not: "RESOLVED" } }, orderBy: { startedAt: "desc" }, take: 100 }), prisma.monitor.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } })]);
return viewDto({ workspace, membership, manage, incidents, monitors } as const);
}
