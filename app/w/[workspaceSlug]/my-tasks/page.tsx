import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "My tasks" };

/** Placeholder: replaced by the my tasks build. */
export default async function MyTasksPage({ params }: PageProps<"/w/[workspaceSlug]/my-tasks">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "MEMBER");
  return <ComingSoon title="My tasks" description="Everything assigned to you, across projects." />;
}
