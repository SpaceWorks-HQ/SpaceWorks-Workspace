import { notFound } from "next/navigation";
import { ProjectSettingsForm } from "@/components/projects/ProjectSettingsForm";
import { requireWorkspace } from "@/lib/permissions";
import { listVisibleTeams } from "@/lib/projects/queries";
import { assignableMembers } from "@/lib/tasks/access";
import { findProjectByKey, permissionsFor, projectSummary } from "@/lib/tasks/queries";

export const metadata = { title: "Project settings" };

/** Project details and archive: admins and the project owner only (others get 404). */
export default async function ProjectSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/settings">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "MEMBER");
  const project = await findProjectByKey(context, key);
  if (!project || !permissionsFor(context, project).canManage) notFound();
  const [summary, members, teams] = await Promise.all([projectSummary(project), assignableMembers(context.workspace.id, null), listVisibleTeams(context)]);
  return <ProjectSettingsForm key={`${summary.key}-${summary.status}`} slug={context.workspace.slug} project={summary} members={members} teams={teams} />;
}
