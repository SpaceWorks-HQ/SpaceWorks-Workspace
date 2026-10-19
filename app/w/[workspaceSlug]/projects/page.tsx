import Link from "next/link";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";
import { Avatar, Chip, EmptyState, PageHeader, ProgressBar } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format/datetime";
import { canContribute, requireWorkspace } from "@/lib/permissions";
import { listProjects, listVisibleTeams, parseStatusFilter, PROJECT_STATUS_FILTERS } from "@/lib/projects/queries";

export const metadata = { title: "Projects" };

const STATUS_LABEL = { ACTIVE: "Active", PAUSED: "Paused", DONE: "Done", ARCHIVED: "Archived" } as const;
const STATUS_TONE = { ACTIVE: "accent", PAUSED: "warning", DONE: "success", ARCHIVED: "outline" } as const;

export default async function ProjectsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/projects">) {
  const { workspaceSlug } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const { workspace, membership } = context;
  const filter = parseStatusFilter((await searchParams).status);
  const [projects, teams] = await Promise.all([listProjects(context, filter), canContribute(membership) ? listVisibleTeams(context) : Promise.resolve([])]);
  const base = `/w/${workspace.slug}/projects`;
  const create = canContribute(membership) ? <NewProjectDialog slug={workspace.slug} teams={teams} /> : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Projects" description="Every build the community is working on. Open one to see its board." actions={create} />
      <NavTabs
        label="Project status"
        items={PROJECT_STATUS_FILTERS.map((option) => ({
          href: option.value === "open" ? base : `${base}?status=${option.value}`,
          label: option.label,
          active: option.value === filter,
        }))}
      />
      {projects.length === 0 ? (
        filter === "open" ? (
          <EmptyState mood="thinking" title="No projects yet." action={create}>
            Start one for the next build night.
          </EmptyState>
        ) : (
          <EmptyState title="Nothing here.">No projects with this status.</EmptyState>
        )
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const open = project.total - project.done;
            return (
              <li key={project.id}>
                <Link href={`${base}/${project.key}`} className="flex h-full flex-col gap-3 rounded-xl border border-line bg-panel p-5 transition-colors duration-[120ms] hover:bg-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-caption font-semibold tabular-nums text-ink-muted">{project.key}</p>
                      <h2 className="break-words text-title text-ink">{project.name}</h2>
                    </div>
                    {project.status !== "ACTIVE" ? <Chip tone={STATUS_TONE[project.status]} size="sm">{STATUS_LABEL[project.status]}</Chip> : null}
                  </div>
                  {project.description ? <p className="line-clamp-2 text-body-ui text-ink-secondary">{project.description}</p> : null}
                  <div className="mt-auto flex flex-col gap-2">
                    <ProgressBar value={project.done} max={Math.max(project.total, 1)} tone="success" label={`${project.name} progress`} />
                    <p className="flex flex-wrap items-center gap-x-2 text-caption tabular-nums text-ink-muted">
                      <span>{project.total === 0 ? "No tasks yet" : `${project.done} of ${project.total} done`}</span>
                      {open > 0 ? <span>· {open} open</span> : null}
                      {project.overdue > 0 ? <span className="font-semibold text-danger-fg">· {project.overdue} overdue</span> : null}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                      {project.owner ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={project.owner.name} src={project.owner.image} size="xs" />
                          {project.owner.name}
                        </span>
                      ) : (
                        <span>No owner</span>
                      )}
                      {project.teamName ? <Chip tone="outline" size="sm">{project.teamName}</Chip> : null}
                      {project.dueOn ? <span className="ml-auto">Target {formatDate(`${project.dueOn}T00:00:00Z`, "UTC")}</span> : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
