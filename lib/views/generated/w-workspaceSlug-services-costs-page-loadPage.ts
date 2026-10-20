// Generated from app/w/[workspaceSlug]/services/costs/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canViewCosts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { aggregateCosts } from "@/lib/monitor/cloud/costs";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/costs">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership) || !canViewCosts(membership, workspace)) notFound();
const now = new Date(), start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), manage = canManageServices(membership);
const [rows, connections, budgets] = await Promise.all([prisma.costSnapshot.findMany({ where: { workspaceId: workspace.id, periodStart: { gte: start, lte: now } } }), prisma.cloudConnection.findMany({ where: { workspaceId: workspace.id }, select: { id: true, label: true } }), prisma.costBudget.findMany({ where: { workspaceId: workspace.id } })]);
const summary = aggregateCosts(rows.map(r => ({ ...r, amount: Number(r.amount) })));
return viewDto({ workspace, manage, rows, connections, budgets, summary } as const);
}
