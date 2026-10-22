import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveMeeting,
  cancelMeeting,
} from "@/lib/calendar/service";
import { mutateMeeting } from "@/lib/meetings/service";
import {
  owner,
  member,
  guest,
  projectId,
  command,
  records,
} from "./fixtures";

export function registerMeetingInvitationTests() {
  it("creates a meeting, attendee rows, notification event and RFC outbox invitations atomically", async () => {
    records.meetingId = (
      await saveMeeting(
        owner,
        command({
          attendeeIds: [member.user.id, guest.user.id],
          externalEmails: ["partner@example.test"],
          projectId,
        }),
      )
    ).id;
    expect(await prisma.meetingAttendee.count({ where: { meetingId: records.meetingId } })).toBe(
      3,
    );
    const event = await prisma.notificationEventRecord.findFirst({
      where: {
        workspaceId: owner.workspace.id,
        type: "meeting.scheduled",
        payload: { path: ["resource", "id"], equals: records.meetingId },
      },
    });
    expect(event).toBeTruthy();
    const emails = await prisma.outboxMessage.findMany({
      where: {
        kind: "email",
        payload: { path: ["workspaceId"], equals: owner.workspace.id },
      },
    });
    expect(
      emails.some((e) => JSON.stringify(e.payload).includes("METHOD:REQUEST")),
    ).toBe(true);
    expect(
      emails.some(
        (e) => (e.payload as { to: string }).to === "partner@example.test",
      ),
    ).toBe(true);
  });
  it("updates an occurrence with the same UID and increased sequence", async () => {
    await saveMeeting(
      owner,
      command({
        id: records.meetingId,
        title: "Updated office planning",
        attendeeIds: [member.user.id, guest.user.id],
        externalEmails: ["partner@example.test"],
        projectId,
      }),
    );
    const m = await prisma.meeting.findFirstOrThrow({
      where: { id: records.meetingId, workspaceId: owner.workspace.id },
    });
    expect(m.sequence).toBe(1);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.updated",
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
            string_contains: `UID:meeting-${records.meetingId}@spaceworks-workspace\r\nSEQUENCE:1`,
          },
        },
      }),
    ).toBeGreaterThan(0);
  });
  it("saves internal and guest RSVP and rejects nonattendees", async () => {
    await mutateMeeting(member, { op: "rsvp", meetingId: records.meetingId, rsvp: "MAYBE" });
    await mutateMeeting(guest, { op: "rsvp", meetingId: records.meetingId, rsvp: "YES" });
    expect(
      (
        await prisma.meetingAttendee.findUniqueOrThrow({
          where: { meetingId_userId: { meetingId: records.meetingId, userId: member.user.id } },
        })
      ).rsvp,
    ).toBe("MAYBE");
    const noInvite = await saveMeeting(owner, command());
    await expect(
      mutateMeeting(guest, { op: "rsvp", meetingId: noInvite.id, rsvp: "YES" }),
    ).rejects.toThrow();
  });
  it("only permits organisers and admins to edit or cancel meetings", async () => {
    await expect(
      saveMeeting(member, command({ id: records.meetingId })),
    ).rejects.toThrow();
    await expect(cancelMeeting(member, records.meetingId)).rejects.toThrow();
    await expect(saveMeeting(guest, command())).rejects.toThrow();
  });
}
