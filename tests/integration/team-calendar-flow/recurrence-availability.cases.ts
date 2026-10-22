import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveMeeting,
} from "@/lib/calendar/service";
import { availabilityFor } from "@/lib/calendar/availability";
import {
  owner,
  member,
  other,
  start,
  end,
  command,
} from "./fixtures";

export function registerRecurrenceAvailabilityTests() {
  it("materialises a finite recurring series in the selected time zone", async () => {
    const series = await saveMeeting(
      owner,
      command({ repeat: "DAILY", until: end }),
    );
    expect(
      await prisma.meeting.count({
        where: { workspaceId: owner.workspace.id, seriesId: series.id },
      }),
    ).toBe(2);
  });
  it("merges availability from meetings, absences and rota without leaking titles or notes", async () => {
    await prisma.availability.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: member.user.id,
        type: "AWAY",
        startsAt: start,
        endsAt: end,
        visibility: "PRIVATE",
        note: "Private reason",
      },
    });
    const result = await availabilityFor(owner, {
      attendeeIds: [member.user.id],
      duration: 60,
      timezone: "Asia/Kolkata",
    });
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("Private reason");
    expect(JSON.stringify(result)).not.toContain("office planning");
    await expect(
      availabilityFor(owner, {
        attendeeIds: [other.user.id],
        duration: 60,
        timezone: "UTC",
      }),
    ).rejects.toThrow();
  });
}
