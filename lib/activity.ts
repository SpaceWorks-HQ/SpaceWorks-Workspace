import "server-only";

import type { Prisma, Visibility } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";

/**
 * Append-only activity feed (workspace, entity and person feeds). Every area
 * records its own verbs; the platform-shell build owns the feed UI. Summaries
 * are short plain text without secrets or private message bodies.
 */
export type ActivityInput = {
  workspaceId: string;
  actorId?: string | null;
  /** created | updated | completed | commented | decided | revealed … */
  verb: string;
  entityType: string;
  entityId: string;
  summary: string;
  visibility?: Visibility;
  teamId?: string | null;
  projectId?: string | null;
  data?: Prisma.InputJsonValue;
};

export async function recordActivity(input: ActivityInput, client: DbClient = prisma) {
  await client.activityEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      verb: input.verb.slice(0, 40),
      entityType: input.entityType.slice(0, 40),
      entityId: input.entityId,
      summary: input.summary.slice(0, 300),
      visibility: input.visibility ?? "WORKSPACE",
      teamId: input.teamId ?? null,
      projectId: input.projectId ?? null,
      ...(input.data === undefined ? {} : { data: input.data }),
    },
  });
}
