import { ChatShell } from "@/components/chat/ChatShell";
import { requireWorkspace } from "@/lib/permissions";
import { getChatShellData } from "@/lib/chat/queries";

/**
 * Chat frame for channels: the conversation list beside every chat page.
 * Pages below still call requireWorkspace themselves (layouts do not re-run
 * on client navigation).
 */
export default async function ChatLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/chat">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const data = await getChatShellData(ctx);
  return (
    <ChatShell
      slug={ctx.workspace.slug}
      timeZone={ctx.workspace.timezone}
      viewer={data.viewer}
      people={data.people}
      channels={data.channels}
      teams={data.teams}
      sidebar={data.sidebar}
      listOnIndex
    >
      {children}
    </ChatShell>
  );
}
