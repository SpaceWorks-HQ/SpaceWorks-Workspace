import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveMeeting,
  cancelMeeting,
} from "@/lib/calendar/service";
import { owner, member, command, calendar, records } from "./fixtures";

export function registerCancellationMembershipTests() {
  it("cancels with a stable UID, increased sequence, notification and CANCEL invitation", async () => {
    await cancelMeeting(owner, records.meetingId);
    await cancelMeeting(owner, records.meetingId);
    expect(
      (await prisma.meeting.findUniqueOrThrow({ where: { id: records.meetingId } }))
        .sequence,
    ).toBe(2);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.cancelled",
          payload: { path: ["resource", "id"], equals: records.meetingId },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: {
          kind: "email",
          payload: {
            path: ["calendarInvite", "content"],
            string_contains: `UID:meeting-${records.meetingId}@spaceworks-workspace\r\nSEQUENCE:2`,
          },
        },
      }),
    ).toBeGreaterThan(0);
  });
  it("checks membership again after suspension", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: member.workspace.id, userId: member.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(calendar(member)).rejects.toThrow();
    await expect(saveMeeting(member, command())).rejects.toThrow();
    await prisma.membership.updateMany({
      where: { workspaceId: member.workspace.id, userId: member.user.id },
      data: { status: "ACTIVE" },
    });
  });
}
