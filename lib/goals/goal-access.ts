import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { type Actor, teamWhere } from "@/lib/meetings/core";

export async function goalWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.GoalWhereInput> {
  return {
    workspaceId: actor.workspace.id,
    ...(await teamWhere(actor, client)),
  };
}
