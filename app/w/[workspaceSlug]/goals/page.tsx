import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { goalWhere } from "@/lib/goals/service";
import { goalRollup } from "@/lib/goals/progress";
import { collaborationChoices, optionalChoice } from "@/lib/meetings/choices";
import { formatDate } from "@/lib/format/datetime";
import { goalAction } from "@/app/actions/goals";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  EntryLink,
} from "@/components/meetings/Structure";
import { FilterForm } from "@/components/meetings/FilterForm";
import { Chip } from "@/components/ui/display";
export const metadata = { title: "Goals" };
export default async function GoalsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/goals">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canContribute(actor.membership)) notFound();
  const quarter = String((await searchParams).quarter ?? "");
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  const start = match
    ? new Date(Date.UTC(Number(match[1]), (Number(match[2]) - 1) * 3, 1))
    : null;
  const end = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) * 3, 1))
    : null;
  const [goals, choices] = await Promise.all([
    prisma.goal.findMany({
      where: await goalWhere(actor),
      include: { keyResults: true },
      orderBy: { periodStart: "desc" },
      take: 300,
    }),
    collaborationChoices(actor),
  ]);
  const filteredGoals =
    start && end
      ? goals.filter((g) => g.periodStart < end && g.periodEnd >= start)
      : goals;
  const rollup = (goalId: string, seen = new Set<string>()): number => {
    if (seen.has(goalId)) return 0;
    seen.add(goalId);
    const goal = goals.find((g) => g.id === goalId);
    return goal
      ? goalRollup(
          goal.keyResults,
          goals
            .filter((g) => g.parentGoalId === goalId)
            .map((g) => rollup(g.id, new Set(seen))),
        )
      : 0;
  };
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Goals"
      description="Set an objective, measure the result, and check in with confidence."
    >
      <FilterForm
        label="Quarter"
        name="quarter"
        value={quarter}
        pattern="[0-9]{4}-Q[1-4]"
        placeholder="2026-Q4"
        help="Use YYYY-Q1, YYYY-Q2, YYYY-Q3 or YYYY-Q4. Leave blank for all."
      />
      <Disclosure title="Set an objective" open={!goals.length}>
        <ActionForm
          slug={workspaceSlug}
          action={goalAction}
          hidden={{ op: "create" }}
          label="Create objective"
          primary
          navigateTo={`/w/${workspaceSlug}/goals/`}
          fields={[
            { name: "title", label: "Objective", required: true },
            { name: "description", label: "Why it matters", type: "textarea" },
            {
              name: "ownerId",
              label: "Owner",
              type: "select",
              value: actor.user.id,
              options: choices.members,
            },
            {
              name: "teamId",
              label: "Team",
              type: "select",
              options: [optionalChoice(), ...choices.teams],
            },
            {
              name: "parentGoalId",
              label: "Parent objective",
              type: "select",
              options: [
                optionalChoice(),
                ...goals.map((g) => ({ value: g.id, label: g.title })),
              ],
              help: "Parent and child objectives must belong to the same team.",
            },
            {
              name: "periodStart",
              label: "Period starts",
              type: "date",
              required: true,
            },
            {
              name: "periodEnd",
              label: "Period ends",
              type: "date",
              required: true,
            },
          ]}
        />
      </Disclosure>
      <ul className="space-y-3">
        {filteredGoals.map((g) => (
          <EntryLink
            key={g.id}
            href={`/w/${workspaceSlug}/goals/${g.id}`}
            title={g.title}
            meta={
              <>
                <Chip
                  tone={
                    g.status === "OFF_TRACK"
                      ? "danger"
                      : g.status === "AT_RISK"
                        ? "warning"
                        : "success"
                  }
                >
                  {g.status.toLowerCase().replaceAll("_", " ")}
                </Chip>
                <span>
                  {rollup(g.id)}% ·{" "}
                  {choices.members.find((m) => m.value === g.ownerId)?.label ??
                    "Former member"}{" "}
                  · {formatDate(g.periodStart, "UTC")} –{" "}
                  {formatDate(g.periodEnd, "UTC")}
                </span>
              </>
            }
          />
        ))}
      </ul>
    </CollaborationShell>
  );
}
