// Generated from app/w/[workspaceSlug]/services/monitors/[id]/edit/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { getScopedDestinationIds, listPickableDestinations } from "@/lib/notify/scopedRules";
import { icmpCapability } from "@/lib/monitor/checks";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/monitors/[id]/edit">) {
const { workspaceSlug, id } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageServices(membership)) notFound();
const monitor = await prisma.monitor.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, name: true, type: true, severity: true, config: true, tags: true, intervalSec: true, timeoutMs: true, retries: true, retryIntervalSec: true, failureThreshold: true, successThreshold: true, reminderIntervalMin: true, useWorkspaceRules: true, incidentOnDegraded: true, degradedLatencyMs: true, cloudResourceId: true, projectId: true } });
if (!monitor) notFound();
const [destinations, selected, resources, projects, icmp] = await Promise.all([listPickableDestinations(workspace.id, membership.role), getScopedDestinationIds(workspace.id, "MONITOR", id), prisma.cloudResource.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }), prisma.project.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }), icmpCapability()]);
const config = { ...(monitor.config as Record<string, unknown>) };
delete config.headers;
return viewDto({ monitor, destinations, selected, resources, projects, icmp, config } as const);
}
