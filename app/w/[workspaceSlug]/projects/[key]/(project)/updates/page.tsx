import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectPlan, projectUpdates } from "@/lib/projects/plusQueries";
import { ProjectUpdateForm, ProjectUpdateHistory } from "@/components/projects/ProjectPlanning";
import { formatDate } from "@/lib/format/datetime";
export const metadata = { title: "Project updates" };
export default async function ProjectUpdatesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/projects/[key]/updates">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const plan = await getProjectPlan(context, key);
  if (!plan) notFound();
  const query = await searchParams;
  const raw = Number(query.page ?? 0);
  const page = Number.isSafeInteger(raw) ? Math.max(0, Math.min(10000, raw)) : 0;
  const updates = page ? await projectUpdates(context, plan.projectId, page) : plan.updates;
  return <div className="space-y-6 [overflow-wrap:anywhere]">
    <p className="text-body-ui">Lead: {plan.lead} · {plan.updateOverdue ? "Update due" : "Next update"}: {formatDate(plan.updateDueAt, plan.timeZone)}</p>
    <ProjectUpdateForm slug={workspaceSlug} plan={plan} />
    <ProjectUpdateHistory updates={updates} timeZone={plan.timeZone} base={plan.base} />
    <nav aria-label="Update history pages" className="flex flex-wrap gap-4">{page > 0 ? <Link className="inline-flex min-h-11 items-center underline" href={`${plan.base}/updates?page=${page - 1}`}>Newer updates</Link> : null}{updates.length === 20 ? <Link className="inline-flex min-h-11 items-center underline" href={`${plan.base}/updates?page=${page + 1}`}>Older updates</Link> : null}</nav>
  </div>;
}
