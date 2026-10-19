import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProjectTabs } from "@/components/projects/ProjectTabs";
import { Chip, PageHeader } from "@/components/ui/display";
import { requireWorkspace } from "@/lib/permissions";
import { findProjectByKey, permissionsFor } from "@/lib/tasks/queries";

const STATUS = { ACTIVE: null, PAUSED: { label: "Paused", tone: "warning" }, DONE: { label: "Done", tone: "success" }, ARCHIVED: { label: "Archived", tone: "outline" } } as const;

/** Project header and tabs. Every page below checks access again (layouts don't re-run on client navigation). */
export default async function ProjectLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/projects/[key]">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const project = await findProjectByKey(context, key);
  if (!project) notFound();
  if (project.key !== key) redirect(`/w/${context.workspace.slug}/projects/${project.key}`);
  const base = `/w/${context.workspace.slug}/projects/${project.key}`;
  const status = STATUS[project.status];
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        kicker={
          <Link href={`/w/${context.workspace.slug}/projects`} className="underline-offset-4 hover:underline">
            Projects
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {project.name}
            <Chip tone="outline" size="sm">
              {project.key}
            </Chip>
            {status ? (
              <Chip tone={status.tone} size="sm">
                {status.label}
              </Chip>
            ) : null}
          </span>
        }
        description={project.description ?? undefined}
      />
      <ProjectTabs base={base} canManage={permissionsFor(context, project).canManage} />
      <div>{children}</div>
    </div>
  );
}
