// Generated from app/w/[workspaceSlug]/settings/cloud-accounts/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageCloudAccounts } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/settings/cloud-accounts">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageCloudAccounts(membership)) notFound();
const connections = await prisma.cloudConnection.findMany({ where: { workspaceId: workspace.id }, orderBy: { label: "asc" }, select: { id: true, provider: true, label: true, accountLabel: true, credentialsHint: true, config: true, lastSyncAt: true, lastError: true, _count: { select: { resources: true } } } });
return viewDto({ workspace, connections } as const);
}
