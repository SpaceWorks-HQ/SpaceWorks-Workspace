import { Suspense } from "react";
import { GithubPullRequests } from "@/components/integrations/GithubPullRequests";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PriorityChip } from "@/components/tasks/bits";
import { Avatar, Card, CardHeader, DetailList, EmptyState, ProgressBar, StatTile } from "@/components/ui/display";
import { formatDate, formatRelativeDay, formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectOverview } from "@/lib/projects/queries";
import { findProjectByKey, projectSummary } from "@/lib/tasks/queries";
import { prisma } from "@/lib/db";

import { getProjectPlan } from "@/lib/projects/plusQueries";
import { ProjectMilestones } from "@/components/projects/ProjectPlanning";

export const metadata = { title: "Project overview" };

export default async function ProjectOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/overview">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const project = await findProjectByKey(context, key);
  if (!project) notFound();
  const plan = await getProjectPlan(context, key);
  if (!plan) notFound();
  const timeZone = context.workspace.timezone;
  const [overview, summary, owner, linkedRepo] = await Promise.all([
    getProjectOverview(context, project),
    projectSummary(project),
    project.ownerId ? prisma.user.findUnique({ where: { id: project.ownerId }, select: { name: true, image: true } }) : Promise.resolve(null),
    prisma.githubRepo.findFirst({ where: { workspaceId: context.workspace.id, linkedProjectId: project.id, connection: { workspaceId: context.workspace.id, status: "ACTIVE" } }, select: { id: true } }),
  ]);
  const total = overview.columns.reduce((sum, column) => sum + column.count, 0);
  const done = overview.columns.filter((column) => column.category === "DONE").reduce((sum, column) => sum + column.count, 0);
  const base = `/w/${context.workspace.slug}/projects/${project.key}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel p-4">
        <p>{plan.progress.percent}% complete · {plan.updateOverdue ? "Weekly update due" : "Next weekly update"}: {formatDate(plan.updateDueAt, timeZone)}</p>
        <Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`${base}/updates`}>Project updates</Link>
      </div>
      <ProjectMilestones slug={workspaceSlug} plan={plan} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open tasks" value={total - done} href={base} />
        <StatTile label="Done" value={done} progress={{ value: done, max: Math.max(total, 1), tone: "success" }} />
        <StatTile label="Overdue" value={overview.overdue} tone={overview.overdue > 0 ? "attention" : "default"} href={`${base}?due=overdue`} />
        <StatTile label="People on it" value={overview.workload.length} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="About" />
          <DetailList
            items={[
              {
                label: "Owner",
                value: owner ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={owner.name} src={owner.image} size="xs" />
                    {owner.name}
                  </span>
                ) : (
                  "No owner"
                ),
              },
              { label: "Team", value: summary.teamName ?? "Whole workspace" },
              { label: "Start", value: summary.startsOn ? formatDate(`${summary.startsOn}T00:00:00Z`, "UTC") : "Not set" },
              { label: "Target", value: summary.dueOn ? formatDate(`${summary.dueOn}T00:00:00Z`, "UTC") : "Not set" },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="By column" />
          {total === 0 ? (
            <p className="text-body-ui text-ink-muted">No tasks yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {overview.columns.map((column) => (
                <li key={column.id} className="flex flex-col gap-1.5">
                  <span className="flex justify-between text-body-ui text-ink">
                    {column.name}
                    <span className="tabular-nums text-ink-muted">{column.count}</span>
                  </span>
                  <ProgressBar value={column.count} max={Math.max(total, 1)} tone={column.category === "DONE" ? "success" : "accent"} label={`${column.name}: ${column.count} of ${total}`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Coming up" description="Open tasks with the nearest due dates." />
          {overview.upcoming.length === 0 ? (
            <p className="text-body-ui text-ink-muted">Nothing has a due date yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {overview.upcoming.map((task) => (
                <li key={task.id} className="flex items-center gap-3 py-2.5">
                  <Link href={task.url} className="min-w-0 flex-1 truncate text-body-ui text-ink underline-offset-4 hover:underline">
                    <span className="mr-2 text-caption font-semibold tabular-nums text-ink-muted">{task.reference}</span>
                    {task.title}
                  </Link>
                  <PriorityChip priority={task.priority} />
                  <span className="shrink-0 text-caption tabular-nums text-ink-muted">{formatRelativeDay(task.dueAt, timeZone)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Who's on what" description="Open tasks per person." />
          {overview.workload.length === 0 ? (
            <p className="text-body-ui text-ink-muted">Nobody is assigned yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {overview.workload.map((row) => (
                <li key={row.person.id} className="flex items-center gap-2.5 text-body-ui text-ink">
                  <Avatar name={row.person.name} src={row.person.image} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{row.person.name ?? "Former member"}</span>
                  <span className="tabular-nums text-ink-muted">{row.open} open</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {linkedRepo ? <Card><Suspense fallback={<p role="status">Loading pull requests and issues…</p>}><GithubPullRequests workspaceSlug={workspaceSlug} projectId={project.id} /></Suspense></Card> : null}
      <Card>
        <CardHeader title="Recent activity" />
        {overview.activity.length === 0 ? (
          <EmptyState className="border-0 p-0" title="Quiet so far.">Changes to tasks show up here.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {overview.activity.map((item) => (
              <li key={item.id} className="text-body-ui text-ink-secondary">
                <span className="font-semibold text-ink">{item.actor?.name ?? "Space Works"}</span> {item.text} on{" "}
                <Link href={item.url} className="font-semibold text-ink underline-offset-4 hover:underline">
                  {item.reference} {item.taskTitle}
                </Link>
                <span className="text-caption text-ink-muted"> · {formatRelativeTime(item.createdAt, timeZone)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
