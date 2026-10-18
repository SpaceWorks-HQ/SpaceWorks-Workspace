import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canLinkExternalAccounts, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Connected accounts" };

/** Placeholder: replaced by the integrations-messaging build (see docs/ROADMAP-BUILD.md). */
export default async function NotificationAccountsPage({ params }: PageProps<"/w/[workspaceSlug]/notifications/accounts">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canLinkExternalAccounts(membership)) notFound();
  return <ComingSoon title="Connected accounts" description="Link your Telegram, Slack, Discord, Mattermost or WhatsApp to get notifications there and talk to the assistant." />;
}
