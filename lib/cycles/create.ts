import "server-only";

import { type DbClient } from "@/lib/db";
import {
  changed,
  ensure,
  type Actor,
} from "@/lib/meetings/core";
import { visibleProjectWhere } from "@/lib/tasks/access";

import type { CycleCommand } from "./validation";

export async function createCycle(
  actor: Actor,
  data: Extract<CycleCommand, { op: "create" }>,
  tx: DbClient,
) {
  ensure(
    data.endsAt > data.startsAt &&
      data.endsAt.getTime() - data.startsAt.getTime() <= 366 * 86_400_000,
    "Choose an end date after the start, within a year.",
  );
  const project = await tx.project.findFirst({
    where: {
      AND: [
        await visibleProjectWhere(actor, tx),
        {
          id: data.projectId,
          cyclesEnabled: true,
          status: { not: "ARCHIVED" },
        },
      ],
    },
  });
  ensure(project, "Enable cycles in an available project first.");
  const last = await tx.cycle.aggregate({
    where: { workspaceId: actor.workspace.id, projectId: project.id },
    _max: { number: true },
  });
  const cycle = await tx.cycle.create({
    data: {
      workspaceId: actor.workspace.id,
      projectId: project.id,
      teamId: project.teamId,
      number: (last._max.number ?? 0) + 1,
      name: data.name,
      goal: data.goal,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
    },
  });
  await changed(
    tx,
    actor,
    "cycle",
    cycle.id,
    data.name,
    `cycles/${cycle.id}`,
    "created",
    data.goal,
    { teamId: project.teamId, projectId: project.id },
  );
  return cycle.id;
}
