import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutateCycle } from "@/lib/cycles/service";
import {
  owner,
  outsider,
  projectId,
  meetingId,
  startsAt,
  endsAt,
  records,
} from "./fixtures";

export function registerCycleReviewTests() {
  it("carries unfinished cycle tasks, leaving a complete review snapshot", async () => {
    records.cycleId = (
      await mutateCycle(owner, {
        op: "create",
        projectId,
        name: "First cycle",
        startsAt,
        endsAt,
      })
    ).id;
    records.nextCycleId = (
      await mutateCycle(owner, {
        op: "create",
        projectId,
        name: "Next cycle",
        startsAt: endsAt,
        endsAt: new Date(endsAt.getTime() + 86_400_000),
      })
    ).id;
    const task = await prisma.task.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, sourceMeetingId: meetingId },
    });
    await mutateCycle(owner, { op: "assign", cycleId: records.cycleId, taskId: task.id });
    await mutateCycle(owner, { op: "start", cycleId: records.cycleId });
    await mutateCycle(owner, {
      op: "complete",
      cycleId: records.cycleId,
      carryToId: records.nextCycleId,
      review: "We agreed the component list.",
    });
    expect(
      await prisma.task.findUnique({ where: { id: task.id } }),
    ).toMatchObject({ cycleId: records.nextCycleId });
    expect(
      await prisma.activityEvent.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "cycle_review",
          entityId: records.cycleId,
        },
      }),
    ).toMatchObject({
      data: {
        review: "We agreed the component list.",
        tasks: [{ id: task.id }],
      },
    });
    await expect(
      mutateCycle(outsider, { op: "start", cycleId: records.nextCycleId }),
    ).rejects.toThrow();
  });
}
