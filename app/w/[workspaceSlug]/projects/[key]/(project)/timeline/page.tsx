import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectPlan } from "@/lib/projects/plusQueries";
import { ProjectTimeline } from "@/components/projects/ProjectTimeline";
export const metadata = { title: "Project timeline" };
export default async function ProjectTimelinePage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/timeline">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const plan = await getProjectPlan(context, key);
  if (!plan) notFound();
  return <ProjectTimeline plan={plan} />;
}
