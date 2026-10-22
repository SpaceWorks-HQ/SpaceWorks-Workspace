import { GoalKeyResults } from "./GoalKeyResults";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { goalWhere } from "@/lib/goals/service";
import { goalRollup } from "@/lib/goals/progress";
import { admin } from "@/lib/meetings/core";
import { collaborationChoices, options } from "@/lib/meetings/choices";
import { formatDate } from "@/lib/format/datetime";
import { goalAction } from "@/app/actions/goals";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
export const metadata = { title: "Objective" };
export default async function GoalPage({
  params,
}: PageProps<"/w/[workspaceSlug]/goals/[goalId]">) {
  const { workspaceSlug, goalId } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const goals = await prisma.goal.findMany({
    where: await goalWhere(actor),
    include: { keyResults: { orderBy: { sortOrder: "asc" } } },
  });
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) notFound();
  const choices = await collaborationChoices(actor);
  const links = await prisma.recordLink.findMany({
    where: {
      workspaceId: actor.workspace.id,
      fromType: "goal",
      fromId: goalId,
    },
  });
  const canEdit = admin(actor) || goal.ownerId === actor.user.id;
  const rollup = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const row = goals.find((g) => g.id === id);
    return row
      ? goalRollup(
          row.keyResults,
          goals
            .filter((g) => g.parentGoalId === id)
            .map((g) => rollup(g.id, new Set(seen))),
        )
      : 0;
  };
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title={goal.title}
      description={`${formatDate(goal.periodStart, "UTC")} – ${formatDate(goal.periodEnd, "UTC")} · ${goal.status.toLowerCase().replaceAll("_", " ")}`}
    >
      <Section title={`${rollup(goal.id)}% complete`}>
        <TextBody>{goal.description}</TextBody>
        <p className="text-caption text-ink-muted">
          Owner:{" "}
          {choices.members.find((m) => m.value === goal.ownerId)?.label ??
            "Former member"}
          . Each direct key result and child objective has equal weight.
        </p>
        <progress
          className="h-3 w-full accent-[var(--yy-primary)]"
          aria-label="Objective progress"
          max={100}
          value={rollup(goal.id)}
        />
        {goals
          .filter((g) => g.parentGoalId === goal.id)
          .map((g) => (
            <a
              key={g.id}
              href={`/w/${workspaceSlug}/goals/${g.id}`}
              className="block min-h-11 py-2 text-accent-text underline"
            >
              {g.title} · {rollup(g.id)}%
            </a>
          ))}
      </Section>
      {canEdit ? (
        <Disclosure title="Edit objective">
          <ActionForm
            slug={workspaceSlug}
            action={goalAction}
            hidden={{ op: "edit", goalId }}
            label="Save objective"
            fields={[
              {
                name: "title",
                label: "Objective",
                value: goal.title,
                required: true,
              },
              {
                name: "description",
                label: "Why it matters",
                type: "textarea",
                value: goal.description ?? "",
              },
              {
                name: "ownerId",
                label: "Owner",
                type: "select",
                value: goal.ownerId ?? actor.user.id,
                options: choices.members,
                required: true,
              },
              {
                name: "periodStart",
                label: "Period starts",
                type: "date",
                value: goal.periodStart.toISOString().slice(0, 10),
                required: true,
              },
              {
                name: "periodEnd",
                label: "Period ends",
                type: "date",
                value: goal.periodEnd.toISOString().slice(0, 10),
                required: true,
              },
            ]}
          />
        </Disclosure>
      ) : null}
      <GoalKeyResults
        keyResults={goal.keyResults}
        workspaceSlug={workspaceSlug}
        goalId={goalId}
        timezone={actor.workspace.timezone}
        canEdit={canEdit}
        options={options}
      />
      {canEdit ? (
        <>
          <Disclosure title="Add a key result">
            <ActionForm
              slug={workspaceSlug}
              action={goalAction}
              hidden={{ op: "result", goalId }}
              label="Add key result"
              reset
              fields={[
                { name: "title", label: "Measurable result", required: true },
                {
                  name: "metricType",
                  label: "Metric",
                  type: "select",
                  options: options(["NUMBER", "PERCENT", "BOOLEAN"]),
                  required: true,
                },
                {
                  name: "start",
                  label: "Starting value",
                  type: "number",
                  value: 0,
                  required: true,
                },
                {
                  name: "target",
                  label: "Target value",
                  type: "number",
                  value: 100,
                  required: true,
                  help: "Boolean results always use 0 and 1.",
                },
              ]}
            />
          </Disclosure>
          <Disclosure title="Update objective status">
            <ActionForm
              slug={workspaceSlug}
              action={goalAction}
              hidden={{ op: "status", goalId }}
              label="Save status"
              fields={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  value: goal.status,
                  options: options([
                    "ON_TRACK",
                    "AT_RISK",
                    "OFF_TRACK",
                    "DONE",
                  ]),
                },
              ]}
            />
          </Disclosure>
        </>
      ) : null}
      <Section title="Linked work">
        <ul>
          {links.map((link) => {
            const project = choices.projects.find(
              (p) => link.toType === "project" && p.id === link.toId,
            );
            const task = choices.tasks.find(
              (t) => link.toType === "task" && t.value === link.toId,
            );
            return project ? (
              <li key={link.id}>
                <a
                  className="inline-flex min-h-11 items-center text-accent-text underline"
                  href={`/w/${workspaceSlug}/projects/${project.key}`}
                >
                  {project.name}
                </a>
              </li>
            ) : task ? (
              <li key={link.id}>
                <a
                  href={task.href}
                  className="inline-flex min-h-11 items-center text-accent-text underline"
                >
                  {task.label}
                </a>
              </li>
            ) : null;
          })}
        </ul>
        {!links.length ? (
          <p className="text-ink-muted">
            No work linked yet. Connect a project or task below.
          </p>
        ) : null}
      </Section>
      {canEdit ? (
        <>
          <Disclosure title="Link a project">
            <ActionForm
              slug={workspaceSlug}
              action={goalAction}
              hidden={{ op: "link", goalId, type: "project" }}
              label="Link project"
              fields={[
                {
                  name: "targetId",
                  label: "Project",
                  type: "select",
                  required: true,
                  options: choices.projects.map((p) => ({
                    value: p.id,
                    label: p.name,
                  })),
                },
              ]}
            />
          </Disclosure>
          <Disclosure title="Link a task">
            <ActionForm
              slug={workspaceSlug}
              action={goalAction}
              hidden={{ op: "link", goalId, type: "task" }}
              label="Link task"
              fields={[
                {
                  name: "targetId",
                  label: "Task",
                  type: "select",
                  required: true,
                  options: choices.tasks,
                },
              ]}
            />
          </Disclosure>
        </>
      ) : null}
    </CollaborationShell>
  );
}
