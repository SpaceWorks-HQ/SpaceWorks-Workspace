import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { cycleWhere } from "@/lib/cycles/service";
import { cycleAction } from "@/app/actions/cycles";
import { formatDate } from "@/lib/format/datetime";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Section,
  Disclosure,
  TextBody,
} from "@/components/meetings/Structure";
import { BurnUp } from "@/components/cycles/BurnUp";
import { toDateInputValue } from "@/lib/tasks/localDate";
import { optionalChoice } from "@/lib/meetings/choices";
export const metadata = { title: "Cycle" };
export default async function CyclePage({
  params,
}: PageProps<"/w/[workspaceSlug]/cycles/[cycleId]">) {
  const { workspaceSlug, cycleId } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const cycle = await prisma.cycle.findFirst({
    where: { ...(await cycleWhere(actor)), id: cycleId },
    include: {
      tasks: {
        where: { workspaceId: actor.workspace.id },
        orderBy: { number: "asc" },
      },
      project: true,
    },
  });
  if (!cycle) notFound();
  const [tasks, next, review] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId: actor.workspace.id,
        projectId: cycle.projectId,
        cycleId: null,
        archivedAt: null,
        completedAt: null,
      },
      select: { id: true, title: true, number: true },
      take: 300,
    }),
    prisma.cycle.findMany({
      where: {
        ...(await cycleWhere(actor)),
        projectId: cycle.projectId,
        id: { not: cycle.id },
        status: { not: "COMPLETED" },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.activityEvent.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        entityType: "cycle_review",
        entityId: cycle.id,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const snapshot = z
    .object({
      review: z.string(),
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          createdAt: z.coerce.date(),
          completedAt: z.coerce.date().nullable(),
          archivedAt: z.coerce.date().nullable(),
        }),
      ),
    })
    .safeParse(review?.data);
  const chartTasks = snapshot.success ? snapshot.data.tasks : cycle.tasks;
  const done = chartTasks.filter((t) => t.completedAt).length;
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title={cycle.name ?? `Cycle ${cycle.number}`}
      description={`${cycle.project?.name} · ${formatDate(cycle.startsAt, actor.workspace.timezone)} – ${formatDate(cycle.endsAt, actor.workspace.timezone)} · ${cycle.status.toLowerCase()}`}
    >
      <Section title="Cycle progress">
        <TextBody>{cycle.goal}</TextBody>
        <p>
          {done} of {chartTasks.length} tasks complete
        </p>
        <progress
          aria-label="Cycle completion"
          className="h-3 w-full accent-[var(--yy-primary)]"
          value={done}
          max={Math.max(1, chartTasks.length)}
        />
        <BurnUp
          tasks={chartTasks}
          startsAt={cycle.startsAt}
          endsAt={cycle.endsAt}
          timezone={actor.workspace.timezone}
        />
      </Section>
      {snapshot.success ? (
        <Section title="Cycle review">
          <TextBody>
            {snapshot.data.review ||
              "Cycle completed without a written review."}
          </TextBody>
          <ul>
            {snapshot.data.tasks.map((t) => (
              <li key={t.id} className="py-2">
                {t.title} · {t.completedAt ? "Completed" : "Unfinished"}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {cycle.status === "COMPLETED" ? (
        <Disclosure title="Write a cycle review">
          <ActionForm
            slug={workspaceSlug}
            action={cycleAction}
            hidden={{ op: "review", cycleId }}
            label="Save review"
            fields={[
              {
                name: "review",
                label: "What worked and what comes next",
                type: "textarea",
                required: true,
                value: snapshot.success ? snapshot.data.review : "",
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {cycle.status !== "COMPLETED" ? (
        <Disclosure title="Edit cycle">
          <ActionForm
            slug={workspaceSlug}
            action={cycleAction}
            hidden={{ op: "edit", cycleId }}
            label="Save cycle"
            fields={[
              {
                name: "name",
                label: "Cycle name",
                value: cycle.name ?? `Cycle ${cycle.number}`,
                required: true,
              },
              {
                name: "goal",
                label: "Focus",
                type: "textarea",
                value: cycle.goal ?? "",
              },
              {
                name: "startsAt",
                label: "Start date",
                type: "date",
                value: toDateInputValue(
                  cycle.startsAt,
                  actor.workspace.timezone,
                ),
                required: true,
              },
              {
                name: "endsAt",
                label: "End date",
                type: "date",
                value: toDateInputValue(cycle.endsAt, actor.workspace.timezone),
                required: true,
              },
            ]}
          />
        </Disclosure>
      ) : null}
      <Section title="Planned tasks">
        <ul className="space-y-3">
          {cycle.tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
            >
              <a
                className="text-accent-text underline"
                href={`/w/${workspaceSlug}/projects/${cycle.project?.key}/${task.number}`}
              >
                #{task.number} {task.title} ·{" "}
                {task.completedAt ? "Done" : "Open"}
              </a>
              {cycle.status !== "COMPLETED" ? (
                <ActionForm
                  slug={workspaceSlug}
                  action={cycleAction}
                  hidden={{
                    op: "assign",
                    cycleId,
                    taskId: task.id,
                    remove: true,
                  }}
                  label="Remove from cycle"
                />
              ) : null}
            </li>
          ))}
        </ul>
        {!cycle.tasks.length ? (
          <p className="text-ink-muted">No tasks assigned. Add a task below.</p>
        ) : null}
      </Section>
      {cycle.status !== "COMPLETED" && tasks.length ? (
        <Disclosure title="Add a task">
          <ActionForm
            slug={workspaceSlug}
            action={cycleAction}
            hidden={{ op: "assign", cycleId }}
            label="Add task"
            fields={[
              {
                name: "taskId",
                label: "Task",
                type: "select",
                required: true,
                options: tasks.map((t) => ({
                  value: t.id,
                  label: `#${t.number} ${t.title}`,
                })),
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {cycle.status === "UPCOMING" ? (
        <ActionForm
          slug={workspaceSlug}
          action={cycleAction}
          hidden={{ op: "start", cycleId }}
          label="Start cycle"
          primary
        />
      ) : cycle.status === "ACTIVE" ? (
        <Disclosure title="Complete and review cycle">
          <ActionForm
            slug={workspaceSlug}
            action={cycleAction}
            hidden={{ op: "complete", cycleId }}
            label="Complete cycle"
            confirm="Complete this cycle and carry unfinished tasks to the selected cycle?"
            fields={[
              {
                name: "review",
                label: "What worked and what comes next",
                type: "textarea",
              },
              {
                name: "carryToId",
                label: "Carry unfinished tasks to",
                type: "select",
                options: [
                  optionalChoice("Keep unfinished tasks here"),
                  ...next.map((c) => ({
                    value: c.id,
                    label: c.name ?? `Cycle ${c.number}`,
                  })),
                ],
              },
            ]}
          />
        </Disclosure>
      ) : null}
    </CollaborationShell>
  );
}
