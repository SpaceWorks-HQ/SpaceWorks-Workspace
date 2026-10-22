import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectPlan } from "@/lib/projects/plusQueries";
import { ProjectReport } from "@/components/projects/ProjectReport";
export const metadata = { title: "Project report" };
export default async function ProjectReportPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/report">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const plan = await getProjectPlan(context, key);
  if (!plan) notFound();
  const generatedAt = new Date().toISOString();
  return <ProjectReport plan={plan} generatedAt={generatedAt} />;
}
