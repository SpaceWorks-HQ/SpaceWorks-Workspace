import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { financeReports } from "@/lib/finance/tools/queries";
import { owner, member, q, result } from "./fixtures";

export function registerTeamVisibilityTests() {
  it("uses all team memberships and hides private project facts", async () => {
    const ws = owner.workspace.id,
      one = await prisma.team.create({
        data: { workspaceId: ws, name: "Programmes", slug: "programmes" },
      }),
      two = await prisma.team.create({
        data: { workspaceId: ws, name: "Office", slug: "office" },
      }),
      hidden = await prisma.team.create({
        data: {
          workspaceId: ws,
          name: "Private planning",
          slug: "private",
          visibility: "PRIVATE",
        },
      });
    await prisma.teamMember.createMany({
      data: [
        { teamId: one.id, userId: member.user.id },
        { teamId: two.id, userId: member.user.id },
      ],
    });
    await prisma.memberProfile.create({
      data: {
        workspaceId: ws,
        userId: member.user.id,
        engagementStart: new Date("2026-10-01"),
      },
    });
    expect((await result(member, "headcount", { team: two.id })).count).toBe(1);
    const project = await prisma.project.create({
      data: {
        workspaceId: ws,
        key: "PRI",
        name: "Private project",
        teamId: hidden.id,
      },
    });
    await prisma.task.create({
      data: {
        workspaceId: ws,
        projectId: project.id,
        number: 91,
        title: "Private task",
        createdAt: new Date("2026-10-01"),
      },
    });
    expect((await result(member, "tasks-created")).count).toBe(0);
    expect((await result(owner, "tasks-created")).count).toBe(1);
    const centre = await prisma.financeCostCentre.create({
      data: {
        workspaceId: ws,
        name: "Private programme accounts",
        kind: "PROJECT",
        projectId: project.id,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        workspaceId: ws,
        kind: "EXPENSE",
        amountMinor: 700,
        currency: "INR",
        description: "Office finance record",
        occurredOn: new Date("2026-10-10"),
        costCentreId: centre.id,
      },
    });
    const finance = await financeReports(
      {
        ...member,
        user: { ...member.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({
          where: { id: ws },
        }),
      },
      q,
    );
    expect((await result(member, "spending")).value).toBe(
      finance.entries
        .filter((e) => e.kind === "EXPENSE")
        .reduce((n, e) => n + e.amountMinor, 0),
    );
  });
}
