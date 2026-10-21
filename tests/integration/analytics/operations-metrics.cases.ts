import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { drillRecords } from "@/lib/analytics/queries";
import { owner, member, q, result } from "./fixtures";

export function registerOperationsMetricTests() {
  it("uses the meeting source visibility for metrics, drill-downs and exported rows", async () => {
    const { meetingWhere } = await import("@/lib/meetings/service"),
      { csv } = await import("@/lib/analytics/metrics"),
      ws = owner.workspace.id,
      team = await prisma.team.create({
        data: { workspaceId: ws, name: "Public meeting team", slug: "meeting-public" },
      }),
      privateTeam = await prisma.team.create({
        data: { workspaceId: ws, name: "Private meeting team", slug: "meeting-private", visibility: "PRIVATE" },
      });
    const cases = [
      { title: "Workspace meeting", visibility: "WORKSPACE" as const },
      { title: "Team meeting secret", visibility: "TEAM" as const, teamId: team.id,
        facilitatorId: member.user.id, attendees: { create: { userId: member.user.id } } },
      { title: "Own team meeting", visibility: "TEAM" as const, teamId: team.id, createdById: member.user.id },
      { title: "Private meeting secret", visibility: "PRIVATE" as const,
        facilitatorId: member.user.id, attendees: { create: { userId: member.user.id } } },
      { title: "Own private meeting", visibility: "PRIVATE" as const, createdById: member.user.id },
      { title: "Private team workspace meeting", visibility: "WORKSPACE" as const, teamId: privateTeam.id },
    ];
    for (const data of cases)
      await prisma.meeting.create({ data: {
        workspaceId: ws, createdById: owner.user.id,
        startsAt: new Date("2026-10-10T10:00:00Z"),
        endsAt: new Date("2026-10-10T11:00:00Z"), ...data,
      } });
    const sourceActor = { ...member, user: { ...member.user, name: null },
      workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    const visibleIds = async () => (await prisma.meeting.findMany({
      where: await meetingWhere(sourceActor), select: { id: true },
    })).map((m) => m.id).sort();
    const drill = await drillRecords(member, "meeting-load", q, 10000);
    expect(drill.rows.map((r) => r.id).sort()).toEqual(await visibleIds());
    expect(drill.rows.map((r) => r.title).sort()).toEqual([
      "Own private meeting", "Own team meeting", "Workspace meeting",
    ]);
    expect((await result(member, "meeting-load")).value).toBe(3);
    expect((await result(owner, "meeting-load")).count).toBe(cases.length);
    const exported = csv(drill.rows.map((r) => [r.title, r.date, r.value]));
    expect(exported).not.toContain("Team meeting secret");
    expect(exported).not.toContain("Private meeting secret");
    await prisma.teamMember.create({ data: { teamId: team.id, userId: member.user.id } });
    expect((await drillRecords(member, "meeting-load", q)).rows.map((r) => r.id).sort())
      .toEqual(await visibleIds());
    expect((await result(member, "meeting-load")).count).toBe(4);
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId: team.id, userId: member.user.id } } });
    expect((await result(member, "meeting-load")).count).toBe(3);
  });
  it("counts only dated open overdue tasks", async () => {
    const ws = owner.workspace.id;
    for (const [index, dueAt, completedAt] of [
      [0, null, null],
      [1, new Date("2026-10-10"), null],
      [2, new Date("2026-11-01"), null],
      [3, new Date("2026-10-10"), new Date("2026-10-11")],
    ] as const)
      await prisma.task.create({ data: {
        workspaceId: ws, number: 200 + index, title: `Due-date regression ${index}`,
        createdAt: new Date("2026-10-01"), dueAt, completedAt,
      } });
    expect((await result(owner, "overdue-tasks")).count).toBe(1);
    expect((await drillRecords(owner, "overdue-tasks", q)).rows.map((r) => r.title))
      .toEqual(["Due-date regression 1"]);
  });
  it("includes issued balances before their due dates and ages them by due date", async () => {
    const common = { workspaceId: owner.workspace.id, currency: "EUR" };
    for (const [index, issuedOn, dueOn] of [
      [0, "2026-10-01", "2026-11-01"],
      [1, "2026-09-01", "2026-09-10"],
      [2, "2026-11-01", "2026-11-15"],
    ] as const) {
      const dates = { issuedOn: new Date(issuedOn), dueOn: new Date(dueOn) };
      await prisma.financeBill.create({ data: { ...common, ...dates,
        vendor: "Ageing fixture", number: `AGE-${index}`, amountMinor: 1200,
        createdById: owner.user.id,
      } });
      await prisma.invoice.create({ data: { ...common, ...dates,
        number: `AGE-${index}`, clientName: "Ageing fixture", totalMinor: 1200,
        status: "SENT", items: [],
      } });
      await prisma.businessDocument.create({ data: { ...common, ...dates,
        title: `Ageing fixture ${index}`, totalMinor: 1200, status: "ISSUED",
        type: "COMMERCIAL_INVOICE", ownerId: owner.user.id, input: {},
      } });
    }
    for (const metric of ["payables", "receivables", "document-receivables"]) {
      const m = await result(owner, metric, { currency: "EUR" });
      expect(m.value).toBe(2400);
      expect(m.groups.map((g) => [g.label, g.value])).toEqual([["0–30", 1200], ["31–60", 1200]]);
      const drill = await drillRecords(owner, metric, { ...q, currency: "EUR" });
      expect(drill.rows).toHaveLength(2);
      expect(drill.rows.map((r) => r.date).sort()).toEqual(["2026-09-10", "2026-11-01"]);
    }
  });
}
