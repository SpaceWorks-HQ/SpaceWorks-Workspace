import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/display";
import { canManageNotificationRouting, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Notifications" };

/** Placeholder: replaced by the integrations-messaging build (see docs/ROADMAP-BUILD.md). */
export default async function NotificationsSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/notifications">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageNotificationRouting(membership)) notFound();
  return (
    <EmptyState mood="thinking" title="Coming in the next build.">
      Save destinations (Slack, Discord, Mattermost, Telegram, WhatsApp, email, webhooks, channels), route events to them with rules, and check the delivery log.
    </EmptyState>
  );
}
