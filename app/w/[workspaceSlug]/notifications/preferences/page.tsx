import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "My notifications" };

/** Placeholder: replaced by the platform-shell build (see docs/ROADMAP-BUILD.md). */
export default async function NotificationPreferencesPage({ params }: PageProps<"/w/[workspaceSlug]/notifications/preferences">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="My notifications" description="Choose where each kind of notification reaches you, set quiet hours, snooze and mutes." />;
}
