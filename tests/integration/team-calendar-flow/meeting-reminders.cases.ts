import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveMeeting,
} from "@/lib/calendar/service";
import { run } from "@/lib/scheduled/calendar";
import { owner, member, command } from "./fixtures";

export function registerMeetingReminderTests() {
  it("sends a meeting reminder once across repeated scheduler runs", async () => {
    const reminder = await saveMeeting(
      owner,
      command({
        startsAt: new Date(Date.now() + 10 * 60000),
        until: new Date(Date.now() + 10 * 60000 + 1000),
        attendeeIds: [member.user.id],
        reminderMinutes: 30,
      }),
    );
    await run(new Date());
    await run(new Date());
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.reminder",
          payload: { path: ["resource", "id"], equals: reminder.id },
        },
      }),
    ).toBe(1);
  });
}
