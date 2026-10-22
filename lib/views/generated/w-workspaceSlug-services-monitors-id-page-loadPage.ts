// Generated from app/w/[workspaceSlug]/services/monitors/[id]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { summarizeChecks } from "@/lib/monitor/stats";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services/monitors/[id]">) {
const { workspaceSlug, id } = await params, query = await searchParams;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
const monitor = await prisma.monitor.findFirst({ where: { id, workspaceId: workspace.id } });
if (!monitor) notFound();
const manage = canManageServices(membership), now = new Date(), hours = query.range === "1h" ? 1 : 24;
const [checks, days, incidents, pings] = await Promise.all([prisma.monitorCheck.findMany({ where: { workspaceId: workspace.id, monitorId: id, checkedAt: { gte: new Date(now.getTime() - 24 * 3600000) } }, orderBy: { checkedAt: "desc" }, take: 6000 }), prisma.monitorRollup.findMany({ where: { workspaceId: workspace.id, monitorId: id, granularity: "DAY", bucketStart: { gte: new Date(now.getTime() - 90 * 86400000) } }, orderBy: { bucketStart: "asc" } }), prisma.incident.findMany({ where: { workspaceId: workspace.id, monitors: { some: { monitorId: id } } }, orderBy: { startedAt: "desc" }, take: 20 }), monitor.type === "HEARTBEAT" ? prisma.heartbeatPing.findMany({ where: { monitorId: id, monitor: { workspaceId: workspace.id } }, orderBy: { receivedAt: "desc" }, take: 20, select: { id: true, kind: true, exitCode: true, durationMs: true, receivedAt: true } }) : []]);
const summary = summarizeChecks(checks, monitor.intervalSec);
return viewDto({ workspace, monitor, manage, now, hours, checks, days, incidents, pings, summary } as const);
}
