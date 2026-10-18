import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Meetings" };

/** Placeholder: replaced by the work-collaboration build (see docs/ROADMAP-BUILD.md). */
export default async function MeetingsPage({ params }: PageProps<"/w/[workspaceSlug]/meetings">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Meetings" description="Agendas, notes, decisions and action items for every sync and board meeting." />;
}
