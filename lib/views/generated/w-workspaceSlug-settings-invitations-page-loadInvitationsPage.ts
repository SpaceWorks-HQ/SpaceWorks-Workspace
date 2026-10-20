// Generated from app/w/[workspaceSlug]/settings/invitations/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";

export async function loadInvitationsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/invitations">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
const invitations = await prisma.invitation.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, email: true, role: true, acceptedAt: true, revokedAt: true, expiresAt: true, lastSentAt: true, invitedBy: { select: { name: true } } },
  });
return viewDto({ workspace, membership, invitations } as const);
}
