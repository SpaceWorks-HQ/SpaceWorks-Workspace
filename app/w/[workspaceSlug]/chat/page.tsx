import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Channels" };

/** Placeholder: replaced by the channels build. */
export default async function ChatPage({ params }: PageProps<"/w/[workspaceSlug]/chat">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Channels" description="Conversations for the whole crew." />;
}
