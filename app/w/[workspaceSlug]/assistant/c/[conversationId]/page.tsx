import { notFound } from "next/navigation";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { requireWorkspace } from "@/lib/permissions";
import { loadChatPage } from "@/lib/assistant/pageData";

export const metadata = { title: "Assistant" };

export default async function AssistantConversationPage({ params }: PageProps<"/w/[workspaceSlug]/assistant/c/[conversationId]">) {
  const { workspaceSlug, conversationId } = await params;
  const { user, workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
  const data = await loadChatPage({ workspaceId: workspace.id, timeZone: workspace.timezone, userId: user.id, userEmail: user.email, conversationId });
  if (!data?.active) notFound();
  return <AssistantChat key={data.active.id} slug={workspace.slug} conversations={data.conversations} active={data.active} configured={data.configured} setupHref={data.setupHref} />;
}
