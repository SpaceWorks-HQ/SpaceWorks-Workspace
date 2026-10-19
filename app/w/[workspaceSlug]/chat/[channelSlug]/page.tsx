import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Conversation } from "@/components/chat/Conversation";
import { requireWorkspace } from "@/lib/permissions";
import { resolveChannel } from "@/lib/chat/access";
import { loadConversation } from "@/lib/chat/page";

export async function generateMetadata({ params }: PageProps<"/w/[workspaceSlug]/chat/[channelSlug]">): Promise<Metadata> {
  const { channelSlug } = await params;
  return { title: `#${decodeURIComponent(channelSlug).slice(0, 80)}` };
}

/** A channel conversation. Unknown, private-to-others and hidden channels are all 404. */
export default async function ChannelPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/chat/[channelSlug]">) {
  const { workspaceSlug, channelSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const resolved = await resolveChannel(ctx, { slug: decodeURIComponent(channelSlug) });
  if (!resolved) notFound();
  const data = await loadConversation(ctx, resolved, await searchParams);
  const key = `${data.info.id}:${data.highlightId ?? ""}:${data.threadId ?? ""}`;
  return <Conversation key={key} info={data.info} initial={data.initial} initialThreadId={data.threadId} highlightId={data.highlightId} />;
}
