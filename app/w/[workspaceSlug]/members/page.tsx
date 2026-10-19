import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Members" };

/** Placeholder: replaced by the members build. */
export default async function MembersPage({ params }: PageProps<"/w/[workspaceSlug]/members">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Members" description="Who's in the crew: skills, roles and how to reach them." />;
}
