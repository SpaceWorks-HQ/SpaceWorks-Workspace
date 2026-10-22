// Generated from app/w/[workspaceSlug]/goals/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { goalWhere } from "@/lib/goals/service";
import { goalRollup } from "@/lib/goals/progress";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadGoalsPage({
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
return viewDto({ actor, quarter, goals, choices, filteredGoals } as const);
}
