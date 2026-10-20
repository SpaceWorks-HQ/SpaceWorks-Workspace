// Generated from app/w/[workspaceSlug]/settings/messaging/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canManageMessaging, requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadMessagingSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/messaging">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageMessaging(membership)) notFound();
const [connections, channels, bridges] = await Promise.all([
    prisma.messagingConnection.findMany({ where: { workspaceId: workspace.id }, select: { id: true, label: true, provider: true, status: true, config: true, lastVerifiedAt: true } }),
    prisma.channel.findMany({ where: { workspaceId: workspace.id, kind: "PUBLIC", teamId: null, archivedAt: null }, select: { id: true, name: true } }),
    prisma.bridgedChannel.findMany({ where: { workspaceId: workspace.id }, include: { workspaceChannel: { select: { name: true } } } }),
  ]);
return viewDto({ connections, channels, bridges } as const);
}
