import { notFound } from "next/navigation";
import { canManageNotificationRouting, requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { RoutingSettings } from "@/components/notify/RoutingSettings";
import { formatDate, formatTime } from "@/lib/format/datetime";
export const metadata = { title: "Notifications" };
export default async function NotificationsSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/notifications">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageNotificationRouting(membership)) notFound();
  const workspaceId = workspace.id;
  const [destinations, rules, connections, channels, projects, monitors, deliveries] = await Promise.all([
    prisma.notificationDestination.findMany({ where: { workspaceId }, select: { id: true, name: true, kind: true, connectionId: true, config: true, enabled: true, health: true }, orderBy: { name: "asc" } }),
    prisma.notificationRule.findMany({ where: { workspaceId, scopeType: "WORKSPACE" }, include: { destinations: { select: { destinationId: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.messagingConnection.findMany({ where: { workspaceId, status: "ACTIVE", lastVerifiedAt: { not: null } }, select: { id: true, label: true, provider: true } }),
    prisma.channel.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.monitor.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.notificationDelivery.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, status: true, attempts: true, lastError: true, createdAt: true, personalChannel: true, event: { select: { title: true } }, destination: { select: { name: true } } } }),
  ]);
  return <div className="space-y-6"><header><h1 className="text-h1">Notification routing</h1><p className="text-ink-secondary">Choose where workspace events go and check their delivery.</p></header><RoutingSettings slug={workspaceSlug} destinations={destinations} rules={rules} connections={connections} channels={channels} projects={projects} monitors={monitors} timeZone={workspace.timezone} deliveries={deliveries.map(d => ({ id: d.id, title: d.event.title, destination: d.destination?.name ?? d.personalChannel ?? "Removed", status: d.status, attempts: d.attempts, error: d.lastError, at: `${formatDate(d.createdAt, workspace.timezone)} · ${formatTime(d.createdAt, workspace.timezone)}` }))} /></div>;
}
