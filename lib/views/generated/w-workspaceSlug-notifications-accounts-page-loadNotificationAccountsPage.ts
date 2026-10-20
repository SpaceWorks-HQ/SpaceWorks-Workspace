// Generated from app/w/[workspaceSlug]/notifications/accounts/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { canLinkExternalAccounts, requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadNotificationAccountsPage({ params }: PageProps<"/w/[workspaceSlug]/notifications/accounts">) {
const { workspaceSlug } = await params;
const { workspace, user, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canLinkExternalAccounts(membership)) notFound();
const [connections, links] = await Promise.all([
    prisma.messagingConnection.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", lastVerifiedAt: { not: null } }, select: { id: true, label: true, provider: true, status: true } }),
    prisma.externalIdentityLink.findMany({ where: { workspaceId: workspace.id, userId: user.id }, select: { id: true, provider: true, connection: { select: { label: true } } } }),
  ]);
return viewDto({ connections, links } as const);
}
