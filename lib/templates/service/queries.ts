import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { hiddenTeamIds, teamScopeFilter, userTeamIds } from "@/lib/teamAccess";
import { type Actor, admin } from "@/lib/meetings/core";

export async function templateWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.TemplateWhereInput> {
  if (admin(actor)) return { workspaceId: actor.workspace.id };
  const hidden = await hiddenTeamIds(
    actor.workspace.id,
    { userId: actor.user.id, role: actor.membership.role },
    client,
  );
  const teams = await userTeamIds(actor.workspace.id, actor.user.id, client);
  return {
    workspaceId: actor.workspace.id,
    AND: [
      teamScopeFilter(hidden),
      {
        OR: [
          { scope: "WORKSPACE" as const },
          { scope: "TEAM" as const, teamId: { in: teams } },
          { createdById: actor.user.id },
        ],
      },
    ],
  };
}
