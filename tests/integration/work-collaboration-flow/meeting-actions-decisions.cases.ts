import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  mutateMeeting,
  meetingWhere,
  decisionWhere,
} from "@/lib/meetings/service";
import {
  owner,
  member,
  guest,
  outsider,
  projectId,
  meetingId,
  foreignMeetingId,
  startsAt,
  endsAt,
} from "./fixtures";

export function registerMeetingActionDecisionTests() {
  it("creates a meeting action and its assigned task atomically, with retry protection", async () => {
    const input = {
      op: "action",
      meetingId,
      title: "Order reusable components",
      projectId,
      assigneeId: member.user.id,
      dueAt: endsAt,
      requestId: "order-parts",
    };
    await mutateMeeting(owner, input);
    await mutateMeeting(owner, input);
    const tasks = await prisma.task.findMany({
      where: { workspaceId: owner.workspace.id, sourceMeetingId: meetingId },
      include: { assignees: true, meetingActionLinks: true },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: input.title,
      dueAt: endsAt,
      projectId,
    });
    expect(tasks[0].assignees[0].userId).toBe(member.user.id);
    expect(tasks[0].meetingActionLinks).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
          kind: "task.assigned",
        },
      }),
    ).toBe(1);
  });
  it("never accepts foreign meetings, assignees or projects for action items", async () => {
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId: foreignMeetingId,
        title: "Foreign action",
        requestId: "foreign",
      }),
    ).rejects.toThrow();
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId,
        title: "Foreign assignee",
        assigneeId: outsider.user.id,
        requestId: "foreign-user",
      }),
    ).rejects.toThrow();
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId,
        title: "Foreign project",
        projectId: "missing",
        requestId: "foreign-project",
      }),
    ).rejects.toThrow();
  });
  it("records searchable decisions, preserving workspace and meeting visibility", async () => {
    await mutateMeeting(owner, {
      op: "decision",
      meetingId,
      title: "Use shared parts",
      contextMd: "Reduce waste",
      decisionMd: "Reuse stock before ordering.",
      ownerId: member.user.id,
    });
    const decisions = await prisma.decision.findMany({
      where: await decisionWhere(owner),
    });
    expect(decisions.some((d) => d.title === "Use shared parts")).toBe(true);
    expect(
      await prisma.decision.count({
        where: { AND: [await decisionWhere(outsider), { meetingId }] },
      }),
    ).toBe(0);
    expect(
      await prisma.searchDocument.count({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "decision",
          body: { contains: "Reuse stock" },
        },
      }),
    ).toBe(1);
  });
  it("hides private meetings and decisions even from other contributors", async () => {
    const privateMeeting = await mutateMeeting(owner, {
      op: "create",
      title: "Private planning",
      startsAt,
      endsAt,
      visibility: "PRIVATE",
    });
    await mutateMeeting(owner, {
      op: "decision",
      meetingId: privateMeeting.id,
      title: "Private outcome",
      decisionMd: "Only the owner should see this.",
    });
    expect(
      await prisma.meeting.findFirst({
        where: { ...(await meetingWhere(member)), id: privateMeeting.id },
      }),
    ).toBeNull();
    expect(
      await prisma.decision.count({
        where: {
          AND: [await decisionWhere(member), { meetingId: privateMeeting.id }],
        },
      }),
    ).toBe(0);
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId: privateMeeting.id,
        title: "Must stay private",
        requestId: "private-action",
      }),
    ).rejects.toThrow();
  });
  it("rejects guest changes while allowing an invited guest to RSVP", async () => {
    await expect(
      mutateMeeting(guest, { op: "agenda", meetingId, title: "Guest edit" }),
    ).rejects.toThrow();
    await mutateMeeting(owner, {
      op: "attendee",
      meetingId,
      userId: guest.user.id,
    });
    await mutateMeeting(guest, { op: "rsvp", meetingId, rsvp: "YES" });
    expect(
      await prisma.meetingAttendee.findFirst({
        where: { meetingId, userId: guest.user.id },
      }),
    ).toMatchObject({ rsvp: "YES" });
  });
}
