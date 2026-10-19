import { notFound } from "next/navigation";
import { Conversation } from "@/components/chat/Conversation";
import { requireWorkspace } from "@/lib/permissions";
import { resolveChannel } from "@/lib/chat/access";
import { loadConversation } from "@/lib/chat/page";

export const metadata = { title: "Direct message" };

/** A direct message. Only its participants can open it; everyone else gets 404. */
export default async function DirectMessagePage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/dm/[channelId]">) {
  const { workspaceSlug, channelId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved || resolved.channel.kind !== "DIRECT") notFound();
  const data = await loadConversation(ctx, resolved, await searchParams);
  const key = `${data.info.id}:${data.highlightId ?? ""}:${data.threadId ?? ""}`;
  return <Conversation key={key} info={data.info} initial={data.initial} initialThreadId={data.threadId} highlightId={data.highlightId} />;
}
