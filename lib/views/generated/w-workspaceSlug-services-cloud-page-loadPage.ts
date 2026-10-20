// Generated from app/w/[workspaceSlug]/services/cloud/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/cloud">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
const resources = await prisma.cloudResource.findMany({ where: { workspaceId: workspace.id, goneAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, kind: true, region: true, status: true, statusDetail: true, metrics: { orderBy: { ts: "desc" }, take: 4, select: { metric: true, value: true } }, connection: { select: { label: true } } } });
const manage = canManageServices(membership);
return viewDto({ workspace, membership, resources, manage } as const);
}
