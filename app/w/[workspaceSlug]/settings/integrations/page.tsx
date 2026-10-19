import { requireWorkspace, canManageIntegrations } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { IntegrationSettings } from "@/components/integrations/IntegrationSettings";
export const metadata = { title: "Integrations" };
export default async function IntegrationsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/integrations">) {
  const { workspaceSlug } = await params; const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageIntegrations(membership)) notFound();
  const [connections, repos, projects, feed] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { workspaceId: workspace.id }, select: { id: true, provider: true, accountLabel: true, status: true } }),
    prisma.githubRepo.findMany({ where: { workspaceId: workspace.id }, select: { id: true, fullName: true, linkedProjectId: true } }),
    prisma.project.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }),
    prisma.githubEvent.findMany({ where: { workspaceId: workspace.id }, select: { id: true, kind: true, title: true, url: true }, orderBy: { receivedAt: "desc" }, take: 50 }),
  ]);
  return <div className="space-y-6"><h1 className="text-h1">Integrations</h1><p>Connect Google services and bring GitHub activity into the workspace.</p><IntegrationSettings slug={workspaceSlug} connections={connections.map(c => ({ id: c.id, provider: c.provider, label: c.accountLabel, status: c.status }))} repos={repos} projects={projects} feed={feed} /></div>;
}
