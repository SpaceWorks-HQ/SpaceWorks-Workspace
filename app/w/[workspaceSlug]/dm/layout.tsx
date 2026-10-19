import { ChatShell } from "@/components/chat/ChatShell";
import { requireWorkspace } from "@/lib/permissions";
import { getChatShellData } from "@/lib/chat/queries";

/** Chat frame for direct messages (members and up; guests have no DMs). */
export default async function DirectMessagesLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/dm">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
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
      listOnIndex={false}
    >
      {children}
    </ChatShell>
  );
}
