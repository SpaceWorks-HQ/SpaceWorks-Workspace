import { notFound } from "next/navigation";
import { canLinkExternalAccounts, requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { ConnectedAccounts } from "@/components/messaging/MessagingSettings";
export const metadata = { title: "Connected accounts" };
export default async function NotificationAccountsPage({ params }: PageProps<"/w/[workspaceSlug]/notifications/accounts">) {
  const { workspaceSlug } = await params;
  const { workspace, user, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canLinkExternalAccounts(membership)) notFound();
  const [connections, links] = await Promise.all([
    prisma.messagingConnection.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", lastVerifiedAt: { not: null } }, select: { id: true, label: true, provider: true, status: true } }),
    prisma.externalIdentityLink.findMany({ where: { workspaceId: workspace.id, userId: user.id }, select: { id: true, provider: true, connection: { select: { label: true } } } }),
  ]);
  return <div className="space-y-6"><h1 className="text-h1">Connected accounts</h1><p>Link your account to receive notifications and talk to the Space Works assistant.</p><ConnectedAccounts slug={workspaceSlug} connections={connections} links={links.map(l => ({ id: l.id, label: l.connection.label, provider: l.provider }))} /></div>;
}
