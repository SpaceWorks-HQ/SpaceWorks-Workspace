// Generated from app/w/[workspaceSlug]/settings/integrations/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace, canManageIntegrations } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export async function loadIntegrationsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/integrations">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageIntegrations(membership)) notFound();
const [connections, repos, projects, feed] = await Promise.all([
    prisma.integrationConnection.findMany({ where: { workspaceId: workspace.id }, select: { id: true, provider: true, accountLabel: true, status: true } }),
    prisma.githubRepo.findMany({ where: { workspaceId: workspace.id }, select: { id: true, fullName: true, linkedProjectId: true } }),
    prisma.project.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }),
    prisma.githubEvent.findMany({ where: { workspaceId: workspace.id }, select: { id: true, kind: true, title: true, url: true }, orderBy: { receivedAt: "desc" }, take: 50 }),
  ]);
return viewDto({ connections, repos, projects, feed } as const);
}
