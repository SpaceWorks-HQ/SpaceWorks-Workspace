import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/workspace/ComingSoon";
import { canContribute, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Goals" };

/** Placeholder: replaced by the work-collaboration build (see docs/ROADMAP-BUILD.md). */
export default async function GoalsPage({ params }: PageProps<"/w/[workspaceSlug]/goals">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(membership)) notFound();
  return <ComingSoon title="Goals" description="The year's goals and key results, with progress check-ins." />;
}
