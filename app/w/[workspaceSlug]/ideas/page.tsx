import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canContribute, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Ideas" };

/** Placeholder: replaced by the work-collaboration build (see docs/ROADMAP-BUILD.md). */
export default async function IdeasPage({ params }: PageProps<"/w/[workspaceSlug]/ideas">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(membership)) notFound();
  return <ComingSoon title="Ideas" description="Ideas and feedback from the crew, with votes and a path to a project." />;
}
