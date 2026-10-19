import { AssistantChat } from "@/components/assistant/AssistantChat";
import { requireWorkspace } from "@/lib/permissions";
import { loadChatPage } from "@/lib/assistant/pageData";

export const metadata = { title: "Assistant" };

export default async function AssistantPage({ params }: PageProps<"/w/[workspaceSlug]/assistant">) {
  const { workspaceSlug } = await params;
  const { user, workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
  const data = (await loadChatPage({ workspaceId: workspace.id, timeZone: workspace.timezone, userId: user.id, userEmail: user.email }))!;
  return <AssistantChat key="new" slug={workspace.slug} conversations={data.conversations} active={null} configured={data.configured} setupHref={data.setupHref} />;
}
