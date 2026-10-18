import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Shoutouts" };

/** Placeholder: replaced by the shoutouts build. */
export default async function ShoutoutsPage({ params }: PageProps<"/w/[workspaceSlug]/shoutouts">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Shoutouts" description="Thank the people who made something happen." />;
}
