import { ChannelBrowser } from "@/components/chat/ChannelBrowser";
import { requireWorkspace } from "@/lib/permissions";
import { browseChannels, listTeamOptions } from "@/lib/chat/queries";

export const metadata = { title: "Browse channels" };

export default async function BrowseChannelsPage({ params }: PageProps<"/w/[workspaceSlug]/chat/browse">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const [channels, teams] = await Promise.all([browseChannels(ctx), listTeamOptions(ctx)]);
  return <ChannelBrowser initial={channels} teams={teams} />;
}
