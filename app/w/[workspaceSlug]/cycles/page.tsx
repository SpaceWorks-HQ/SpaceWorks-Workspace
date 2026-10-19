import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canContribute, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Cycles" };

/** Placeholder: replaced by the work-collaboration build (see docs/ROADMAP-BUILD.md). */
export default async function CyclesPage({ params }: PageProps<"/w/[workspaceSlug]/cycles">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(membership)) notFound();
  return <ComingSoon title="Cycles" description="Time-boxed cycles for projects; unfinished work rolls over." />;
}
