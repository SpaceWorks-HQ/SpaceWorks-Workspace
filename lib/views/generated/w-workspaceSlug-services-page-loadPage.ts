// Generated from app/w/[workspaceSlug]/services/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canViewCosts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { checkerHealth } from "@/lib/monitor/scheduler";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services">) {
const { workspaceSlug } = await params, query = await searchParams;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
const manage = canManageServices(membership), costs = canViewCosts(membership, workspace), now = new Date();
const q = typeof query.q === "string" ? query.q.slice(0, 100) : "", state = typeof query.status === "string" ? query.status : "";
const monitors = await prisma.monitor.findMany({ where: { workspaceId: workspace.id, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, type: true, tags: true, lastStatus: true, lastLatencyMs: true, rollups: { where: { workspaceId: workspace.id, granularity: "DAY", bucketStart: { gte: new Date(now.getTime() - 90 * 86400000) } }, orderBy: { bucketStart: "asc" } } } });
const visible = monitors.filter(m => !state || m.lastStatus === state);
const health = await checkerHealth();
const incidents = await prisma.incident.count({ where: { workspaceId: workspace.id, status: { not: "RESOLVED" } } });
return viewDto({ workspace, manage, costs, now, q, state, monitors, visible, health, incidents } as const);
}
