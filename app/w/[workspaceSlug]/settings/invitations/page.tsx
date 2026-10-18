import { InvitationsPanel } from "@/components/settings/InvitationsPanel";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format/datetime";
import { invitationState } from "@/lib/invitationTokens";
import { assignableRoles, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Invitations" };

export default async function InvitationsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/invitations">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  const invitations = await prisma.invitation.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, email: true, role: true, acceptedAt: true, revokedAt: true, expiresAt: true, lastSentAt: true, invitedBy: { select: { name: true } } },
  });
  return (
    <InvitationsPanel
      slug={workspace.slug}
      roles={assignableRoles(membership)}
      invitations={invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        state: invitationState(invitation),
        sentLabel: formatRelativeTime(invitation.lastSentAt, workspace.timezone),
        invitedBy: invitation.invitedBy?.name ?? null,
      }))}
    />
  );
}
