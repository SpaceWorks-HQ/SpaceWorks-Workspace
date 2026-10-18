import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Calendar" };

/** Placeholder: replaced by the calendar build. */
export default async function CalendarPage({ params }: PageProps<"/w/[workspaceSlug]/calendar">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Calendar" description="Build nights, meetups and workshops." />;
}
