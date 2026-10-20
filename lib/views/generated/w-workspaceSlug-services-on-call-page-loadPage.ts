// Generated from app/w/[workspaceSlug]/services/on-call/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/services/on-call">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewServices(membership)) notFound();
const [schedules, members, policies] = await Promise.all([prisma.onCallSchedule.findMany({ where: { workspaceId: workspace.id } }), prisma.membership.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true, user: { select: { name: true } } } }), prisma.escalationPolicy.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } })]);
const manage = canManageServices(membership);
return viewDto({ workspace, membership, schedules, members, policies, manage } as const);
}
