// Generated from app/w/[workspaceSlug]/settings/notifications/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canManageNotificationRouting, requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadNotificationsSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/notifications">) {
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
return viewDto({ workspace, destinations, rules, connections, channels, projects, monitors, deliveries } as const);
}
