import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { cycleWhere } from "@/lib/cycles/service";
import { formatDate } from "@/lib/format/datetime";
import { collaborationChoices } from "@/lib/meetings/choices";
import { cycleAction } from "@/app/actions/cycles";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  EntryLink,
} from "@/components/meetings/Structure";
import { Chip, EmptyState } from "@/components/ui/display";
export const metadata = { title: "Cycles" };
export default async function CyclesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/cycles">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const [cycles, choices] = await Promise.all([
    prisma.cycle.findMany({
      where: await cycleWhere(actor),
      orderBy: { startsAt: "desc" },
      include: {
        project: { select: { name: true } },
        _count: { select: { tasks: true } },
      },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
  const projects = choices.projects.filter((p) => p.cyclesEnabled);
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Cycles"
      description="Choose a focus, plan the tasks, and review what the crew built."
    >
      {projects.length ? (
        <Disclosure title="Plan a cycle" open={!cycles.length}>
          <ActionForm
            slug={workspaceSlug}
            action={cycleAction}
            hidden={{ op: "create" }}
            label="Plan cycle"
            primary
            navigateTo={`/w/${workspaceSlug}/cycles/`}
            fields={[
              { name: "name", label: "Cycle name", required: true },
              {
                name: "projectId",
                label: "Project",
                type: "select",
                options: projects.map((p) => ({ value: p.id, label: p.name })),
                required: true,
              },
              { name: "goal", label: "Focus", type: "textarea" },
              {
                name: "startsAt",
                label: "Start date",
                type: "date",
                required: true,
              },
              {
                name: "endsAt",
                label: "End date",
                type: "date",
                required: true,
              },
            ]}
          />
        </Disclosure>
      ) : (
        <EmptyState
          title="Enable cycles in a project to plan your first sprint."
          action={
            <a
              className="text-accent-text underline"
              href={`/w/${workspaceSlug}/projects`}
            >
              Open projects
            </a>
          }
        />
      )}
      <ul className="space-y-3">
        {cycles.map((cycle) => (
          <EntryLink
            key={cycle.id}
            href={`/w/${workspaceSlug}/cycles/${cycle.id}`}
            title={cycle.name ?? `Cycle ${cycle.number}`}
            meta={
              <>
                <Chip tone={cycle.status === "ACTIVE" ? "success" : "neutral"}>
                  {cycle.status.toLowerCase()}
                </Chip>
                <span>
                  {cycle.project?.name} ·{" "}
                  {formatDate(cycle.startsAt, actor.workspace.timezone)} –{" "}
                  {formatDate(cycle.endsAt, actor.workspace.timezone)} ·{" "}
                  {cycle._count.tasks} tasks
                </span>
              </>
            }
          />
        ))}
      </ul>
    </CollaborationShell>
  );
}
