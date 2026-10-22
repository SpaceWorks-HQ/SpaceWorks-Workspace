import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveMeeting,
  cancelMeeting,
  moveTaskDue,
} from "@/lib/calendar/service";
import {
  owner,
  member,
  guest,
  other,
  projectId,
  taskId,
  secretTaskId,
  teamId,
  command,
  calendar,
  records,
} from "./fixtures";

export function registerTaskVisibilityTests() {
  it("loads long maintenance windows and hides private-team task dates", async () => {
    const maintenance = await prisma.maintenanceWindow.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Three-day office network work",
        startsAt: new Date(Date.now() - 2 * 86400000),
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    const items = (await calendar(member)).items;
    expect(
      items.some((i) => i.id.startsWith(`maintenance:${maintenance.id}`)),
    ).toBe(true);
    expect(items.some((i) => i.sourceId === taskId)).toBe(true);
    expect(items.some((i) => i.sourceId === secretTaskId)).toBe(false);
  });
  it("limits guests to meetings and tasks they are part of", async () => {
    const items = (await calendar(guest)).items;
    expect(items.some((i) => i.sourceId === records.meetingId)).toBe(true);
    expect(items.some((i) => i.sourceId === taskId)).toBe(false);
    expect(
      items.every((i) => ["meeting", "task", "reminder"].includes(i.layer)),
    ).toBe(true);
  });
  it("changes task due dates through the task service with role and team checks", async () => {
    await moveTaskDue(member, { taskId, dueDate: "2026-12-10" });
    expect(
      (
        await prisma.task.findFirstOrThrow({
          where: { id: taskId, workspaceId: owner.workspace.id },
        })
      ).dueAt?.toISOString(),
    ).toBe("2026-12-09T18:30:00.000Z");
    await expect(
      moveTaskDue(guest, { taskId, dueDate: "2026-12-11" }),
    ).rejects.toThrow();
    await expect(
      moveTaskDue(member, { taskId: secretTaskId, dueDate: "2026-12-11" }),
    ).rejects.toThrow();
    await expect(
      moveTaskDue(other, { taskId, dueDate: "2026-12-11" }),
    ).rejects.toThrow();
  });
  it("rejects foreign attendees, projects and teams and cross-workspace changes", async () => {
    await expect(
      saveMeeting(owner, command({ attendeeIds: [other.user.id] })),
    ).rejects.toThrow();
    await expect(saveMeeting(other, command({ projectId }))).rejects.toThrow();
    await expect(saveMeeting(other, command({ teamId }))).rejects.toThrow();
    await expect(cancelMeeting(other, records.meetingId)).rejects.toThrow();
    expect(
      (await calendar(other)).items.some((i) => i.sourceId === records.meetingId),
    ).toBe(false);
  });
}
