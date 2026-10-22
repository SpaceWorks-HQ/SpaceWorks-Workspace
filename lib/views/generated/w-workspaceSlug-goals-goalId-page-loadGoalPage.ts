// Generated from app/w/[workspaceSlug]/goals/[goalId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { goalWhere } from "@/lib/goals/service";
import { goalRollup } from "@/lib/goals/progress";
import { admin } from "@/lib/meetings/core";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadGoalPage({
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
return viewDto({ actor, goals, goal, choices, links, canEdit } as const);
}
