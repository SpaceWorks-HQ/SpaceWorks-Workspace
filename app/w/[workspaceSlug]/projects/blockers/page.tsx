import { requireWorkspace } from "@/lib/permissions";
import { listProjectBlockers } from "@/lib/projects/plusQueries";
import { ProjectBlockers } from "@/components/projects/ProjectBlockers";
export const metadata = { title: "Project blockers" };
export default async function ProjectBlockersPage({ params }: PageProps<"/w/[workspaceSlug]/projects/blockers">) {
  const { workspaceSlug } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const rows = await listProjectBlockers(context);
  const base = `/w/${context.workspace.slug}/projects`;
  return <ProjectBlockers rows={rows} base={base} />;
}
