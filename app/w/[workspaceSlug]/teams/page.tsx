import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Teams" };

/** Placeholder: replaced by the people-relationships build (see docs/ROADMAP-BUILD.md). */
export default async function TeamsPage({ params }: PageProps<"/w/[workspaceSlug]/teams">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Teams" description="Crews inside the community: ops, events, infra and comms, with their leads, channels and projects." />;
}
