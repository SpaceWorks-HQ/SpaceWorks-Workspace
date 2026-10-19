import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Boardroom" };

/** Placeholder: replaced by the boardroom build. */
export default async function BoardroomPage({ params }: PageProps<"/w/[workspaceSlug]/boardroom">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "MEMBER");
  return <ComingSoon title="Boardroom" description="Put a question to a panel of AI advisors and get a summary." />;
}
