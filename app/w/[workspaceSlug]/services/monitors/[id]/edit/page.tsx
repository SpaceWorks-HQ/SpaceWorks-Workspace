import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";


import { MonitorForm } from "@/components/services/MonitorForm";
import { getScopedDestinationIds, listPickableDestinations } from "@/lib/notify/scopedRules";
import { icmpCapability } from "@/lib/monitor/checks";
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/services/monitors/[id]/edit">) {
 const { workspaceSlug, id } = await params;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN"); if (!canManageServices(membership)) notFound();
 const monitor = await prisma.monitor.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, name: true, type: true, severity: true, config: true, tags: true, intervalSec: true, timeoutMs: true, retries: true, retryIntervalSec: true, failureThreshold: true, successThreshold: true, reminderIntervalMin: true, useWorkspaceRules: true, incidentOnDegraded: true, degradedLatencyMs: true, cloudResourceId: true, projectId: true } }); if (!monitor) notFound();
 const [destinations, selected, resources, projects, icmp] = await Promise.all([listPickableDestinations(workspace.id, membership.role), getScopedDestinationIds(workspace.id, "MONITOR", id), prisma.cloudResource.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }), prisma.project.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }), icmpCapability()]);
 const config = { ...(monitor.config as Record<string, unknown>) }; delete config.headers;
 return <div className="max-w-3xl space-y-6"><h1 className="text-h1">Edit {monitor.name}</h1><Card><MonitorForm slug={workspaceSlug} initial={{ ...monitor, config }} destinations={destinations} selected={selected} resources={resources} projects={projects} icmp={icmp} /></Card></div>;
}
