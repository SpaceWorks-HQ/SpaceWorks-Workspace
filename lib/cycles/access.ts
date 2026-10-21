import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { type Actor } from "@/lib/meetings/core";
import { visibleProjectWhere } from "@/lib/tasks/access";
import type { Prisma } from "@prisma/client";

export async function cycleWhere(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Prisma.CycleWhereInput> {
  return {
    workspaceId: actor.workspace.id,
    project: {
      ...(await visibleProjectWhere(actor, client)),
      cyclesEnabled: true,
    },
  };
}
