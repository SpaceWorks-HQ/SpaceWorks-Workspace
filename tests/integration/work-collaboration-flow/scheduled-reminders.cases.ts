import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { run } from "@/lib/scheduled/collaboration";
import { owner, meetingId, startsAt } from "./fixtures";

export function registerScheduledReminderTests() {
  it("runs periodic work idempotently across replicas", async () => {
    const clock = new Date(startsAt.getTime() - 3_600_000);
    await run(clock);
    await run(clock);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.agenda_reminder",
          payload: { path: ["data", "meetingId"], equals: meetingId },
        },
      }),
    ).toBe(1);
  });
}
