// Generated from app/w/[workspaceSlug]/services/monitors/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { listPickableDestinations } from "@/lib/notify/scopedRules";
import { icmpCapability } from "@/lib/monitor/checks";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services/monitors/new">) {
const { workspaceSlug } = await params;
const query = await searchParams;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageServices(membership)) notFound();
const [destinations, resources, projects, icmp] = await Promise.all([listPickableDestinations(workspace.id, membership.role), prisma.cloudResource.findMany({ where: { workspaceId: workspace.id, goneAt: null }, select: { id: true, name: true } }), prisma.project.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }), icmpCapability()]);
return viewDto({ destinations, resources, projects, icmp } as const);
}
