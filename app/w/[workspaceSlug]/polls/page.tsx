import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canContribute, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Polls" };

/** Placeholder: replaced by the work-collaboration build (see docs/ROADMAP-BUILD.md). */
export default async function PollsPage({ params }: PageProps<"/w/[workspaceSlug]/polls">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(membership)) notFound();
  return <ComingSoon title="Polls" description="Quick polls, scheduling polls and formal motions for the core team." />;
}
