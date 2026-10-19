import "server-only";
import { prisma } from "@/lib/db";
import type { SearchActor } from "@/lib/search/query";
import { userTeamIds, hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { hasRoleAtLeast } from "@/lib/roles";
export async function listSavedViews(actor: SearchActor, entityType: string) {
  const [teams, hidden] = await Promise.all([
    userTeamIds(actor.workspaceId, actor.userId),
    hiddenTeamIds(actor.workspaceId, actor),
  ]);
  return prisma.savedView.findMany({
    where: {
      workspaceId: actor.workspaceId,
      entityType,
      AND: [
        teamScopeFilter(hidden),
        {
          OR: [
            { ownerId: actor.userId },
            { shared: "WORKSPACE" },
            { shared: "TEAM", teamId: { in: teams } },
            ...(hasRoleAtLeast(actor.role, "ADMIN") ? [{}] : []),
          ],
        },
      ],
    },
    orderBy: [{ pinned: "desc" }, { name: "asc" }],
    take: 50,
  });
}
