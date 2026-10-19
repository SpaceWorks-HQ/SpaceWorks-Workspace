import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";


import { MonitorForm } from "@/components/services/MonitorForm";
import { listPickableDestinations } from "@/lib/notify/scopedRules";
import { icmpCapability } from "@/lib/monitor/checks";
export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services/monitors/new">) {
 const { workspaceSlug } = await params;
 const query = await searchParams;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN"); if (!canManageServices(membership)) notFound();
 const [destinations, resources, projects, icmp] = await Promise.all([listPickableDestinations(workspace.id, membership.role), prisma.cloudResource.findMany({ where: { workspaceId: workspace.id, goneAt: null }, select: { id: true, name: true } }), prisma.project.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }), icmpCapability()]);
 return <div className="max-w-3xl space-y-6"><h1 className="text-h1">Add monitor</h1><Card><MonitorForm slug={workspaceSlug} destinations={destinations} resources={resources} projects={projects} icmp={icmp} resourceId={typeof query.resource === "string" && resources.some(r => r.id === query.resource) ? query.resource : undefined} /></Card></div>;
}
