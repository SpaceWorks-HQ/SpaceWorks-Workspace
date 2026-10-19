import { ChannelBrowser } from "@/components/chat/ChannelBrowser";
import { requireWorkspace } from "@/lib/permissions";
import { browseChannels, listTeamOptions } from "@/lib/chat/queries";

export const metadata = { title: "Channels" };

/**
 * Chat home. Phones see the conversation list (from the layout); wider
 * screens see the list beside the channel browser.
 */
export default async function ChatPage({ params }: PageProps<"/w/[workspaceSlug]/chat">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const [channels, teams] = await Promise.all([browseChannels(ctx), listTeamOptions(ctx)]);
  return <ChannelBrowser initial={channels} teams={teams} />;
}
