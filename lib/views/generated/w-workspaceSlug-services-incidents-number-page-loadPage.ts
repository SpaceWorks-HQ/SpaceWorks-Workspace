// Generated from app/w/[workspaceSlug]/services/incidents/[number]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canAckIncidents } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/incidents/[number]">) {
const { workspaceSlug, number } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
if (!/^\d+$/.test(number)) notFound();
const incident = await prisma.incident.findFirst({ where: { workspaceId: workspace.id, number: Number(number) }, include: { updates: { orderBy: { createdAt: "asc" } }, monitors: { where: { monitor: { workspaceId: workspace.id } }, select: { monitor: { select: { id: true, name: true } } } } } });
if (!incident) notFound();
const manage = canManageServices(membership), canAck = canAckIncidents(membership, workspace);
const postmortemDoc = incident.postmortemDocId ? await prisma.doc.findFirst({ where: { id: incident.postmortemDocId, workspaceId: workspace.id, archivedAt: null, ...(!manage ? { visibility: "WORKSPACE" } : {}) }, select: { id: true, title: true } }) : null;
const docs = manage ? await prisma.doc.findMany({ where: { workspaceId: workspace.id, archivedAt: null }, select: { id: true, title: true }, take: 100 }) : [];
return viewDto({ workspace, incident, manage, canAck, postmortemDoc, docs } as const);
}
