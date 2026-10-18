import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/display";
import { canManageMessaging, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Messaging" };

/** Placeholder: replaced by the integrations-messaging build (see docs/ROADMAP-BUILD.md). */
export default async function MessagingSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/messaging">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageMessaging(membership)) notFound();
  return (
    <EmptyState mood="thinking" title="Coming in the next build.">
      Connect Slack, Discord, Mattermost, Telegram and WhatsApp bots, and bridge channels.
    </EmptyState>
  );
}
