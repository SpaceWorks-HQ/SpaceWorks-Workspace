import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Assistant" };

/** Placeholder: replaced by the assistant build. */
export default async function AssistantPage({ params }: PageProps<"/w/[workspaceSlug]/assistant">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "MEMBER");
  return <ComingSoon title="Assistant" description="Ask the Space Works Assistant about anything in the workspace." />;
}
