import { notFound } from "next/navigation";
import { canManageMessaging, requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { MessagingSettings } from "@/components/messaging/MessagingSettings";
export const metadata = { title: "Messaging" };
export default async function MessagingSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/messaging">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageMessaging(membership)) notFound();
  const [connections, channels, bridges] = await Promise.all([
    prisma.messagingConnection.findMany({ where: { workspaceId: workspace.id }, select: { id: true, label: true, provider: true, status: true, config: true, lastVerifiedAt: true } }),
    prisma.channel.findMany({ where: { workspaceId: workspace.id, kind: "PUBLIC", teamId: null, archivedAt: null }, select: { id: true, name: true } }),
    prisma.bridgedChannel.findMany({ where: { workspaceId: workspace.id }, include: { workspaceChannel: { select: { name: true } } } }),
  ]);
  return <div className="space-y-6"><header><h1 className="text-h1">Messaging</h1><p>Connect the crew’s messaging tools and bridge public channels.</p></header><MessagingSettings slug={workspaceSlug} connections={connections.map(c => ({ ...c, lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null }))} channels={channels} bridges={bridges.map(b => ({ id: b.id, name: b.workspaceChannel.name, external: b.externalChannelName ?? b.externalChannelId, direction: b.direction }))} base={(process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "").replace(/\/$/, "")} /></div>;
}
