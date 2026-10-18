import { ComingSoon } from "@/components/workspace/ComingSoon";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Projects" };

/** Placeholder: replaced by the projects build. */
export default async function ProjectsPage({ params }: PageProps<"/w/[workspaceSlug]/projects">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  return <ComingSoon title="Projects" description="Every build the community is working on." />;
}
