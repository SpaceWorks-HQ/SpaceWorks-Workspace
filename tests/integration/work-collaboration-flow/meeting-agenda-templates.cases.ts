import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  mutateMeeting,
} from "@/lib/meetings/service";
import { mutateTemplate } from "@/lib/templates/service";
import { owner, member, meetingId, startsAt, endsAt } from "./fixtures";

export function registerMeetingAgendaTemplateTests() {
  it("orders and edits agenda items with tenant checks", async () => {
    await mutateMeeting(member, {
      op: "agenda",
      meetingId,
      title: "Progress",
      durationMin: 15,
    });
    await mutateMeeting(owner, {
      op: "agenda",
      meetingId,
      title: "Next build",
      durationMin: 10,
    });
    const agenda = await prisma.agendaItem.findMany({
      where: { meetingId },
      orderBy: { sortOrder: "asc" },
    });
    await mutateMeeting(owner, {
      op: "reorder",
      meetingId,
      agendaIds: agenda.map((a) => a.id).reverse(),
    });
    expect(
      (
        await prisma.agendaItem.findMany({
          where: { meetingId },
          orderBy: { sortOrder: "asc" },
        })
      )[0].title,
    ).toBe("Next build");
    await expect(
      mutateMeeting(owner, {
        op: "reorder",
        meetingId,
        agendaIds: [agenda[0].id, "foreign"],
      }),
    ).rejects.toThrow();
  });
  it("materialises finite recurring series and meeting templates", async () => {
    const template = await mutateTemplate(owner, {
      op: "create",
      kind: "MEETING",
      name: "Weekly review",
      title: "Review",
      text: "Progress\nDecisions\nNext actions",
    });
    const root = await mutateMeeting(owner, {
      op: "create",
      title: "Weekly review",
      startsAt,
      endsAt,
      repeat: "WEEKLY",
      occurrences: 3,
      templateId: template.id,
    });
    const series = await prisma.meeting.findMany({
      where: { workspaceId: owner.workspace.id, seriesId: root.id },
      include: { agenda: true },
    });
    expect(series).toHaveLength(3);
    expect(series.every((m) => m.agenda.length === 3)).toBe(true);
  });
}
