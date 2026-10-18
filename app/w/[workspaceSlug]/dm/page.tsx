import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Direct messages" };

/** Placeholder: replaced by the direct messages build. */
export default async function DmPage({ params }: PageProps<"/w/[workspaceSlug]/dm">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "MEMBER");
  return <ComingSoon title="Direct messages" description="One-to-one and small group chats." />;
}
