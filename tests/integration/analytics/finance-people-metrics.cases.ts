import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { financeReports } from "@/lib/finance/tools/queries";
import { owner, member, q, result } from "./fixtures";

export function registerFinanceAndPeopleMetricTests() {
  it("uses the canonical budget actuals including category-selection precedence", async () => {
    const ws = owner.workspace.id,
      category = await prisma.financeCategory.create({
        data: { workspaceId: ws, kind: "EXPENSE", name: "Repairs" },
      }),
      b = await prisma.budget.create({
        data: {
          workspaceId: ws,
          name: "Repairs budget",
          periodStart: new Date("2026-10-01"),
          periodEnd: new Date("2026-10-31"),
          amountMinor: 10000,
          currency: "INR",
          categories: [category.id],
        },
      });
    await prisma.ledgerEntry.createMany({
      data: [
        {
          workspaceId: ws,
          kind: "EXPENSE",
          amountMinor: 500,
          currency: "INR",
          description: "Repairs allocation",
          categoryId: category.id,
          occurredOn: new Date("2026-10-10"),
        },
        {
          workspaceId: ws,
          kind: "EXPENSE",
          amountMinor: 1000,
          currency: "INR",
          description: "Explicit tag outside selected category",
          budgetId: b.id,
          occurredOn: new Date("2026-10-10"),
        },
      ],
    });
    const m = await result(owner, "budgets"),
      finance = await financeReports(
        {
          ...owner,
          user: { ...owner.user, name: null },
          workspace: await prisma.workspace.findUniqueOrThrow({
            where: { id: ws },
          }),
        },
        q,
      );
    expect(m.groups.find((g) => g.label === b.name)?.value).toBe(5);
    expect(finance.budgets.find((r) => r.id === b.id)?.actualMinor).toBe(500);
  });
  it("matches the Attendance tool for legacy approved leave and cancellation", async () => {
    const { dayRange } = await import("@/lib/people/availability"),
      { attendanceData } = await import("@/lib/orgPeople/service"),
      ws = owner.workspace.id,
      range = dayRange("2026-10-12", "2026-10-12", owner.workspace.timezone);
    await prisma.attendanceEntry.create({
      data: {
        workspaceId: ws,
        userId: member.user.id,
        dateOn: new Date("2026-10-12"),
        status: "PRESENT",
        recordedById: owner.user.id,
      },
    });
    await prisma.availability.create({
      data: { workspaceId: ws, userId: member.user.id, type: "AWAY", ...range },
    });
    const request = await prisma.checklistRun.create({
      data: {
        workspaceId: ws,
        kind: "CUSTOM",
        title: "Approved leave",
        subjectUserId: member.user.id,
        status: "DONE",
        items: {
          create: {
            title: "Request",
            sourceType: "availability_request",
            descriptionMd: JSON.stringify({
              from: "2026-10-12",
              to: "2026-10-12",
              type: "AWAY",
              visibility: "PRIVATE",
            }),
          },
        },
      },
    });
    expect((await result(member, "attendance")).count).toBe(0);
    expect((await result(owner, "leave")).value).toBe(1);
    const source = await attendanceData(
      {
        ...member,
        user: { ...member.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({
          where: { id: ws },
        }),
      },
      "2026-10",
    );
    expect(
      source.cells.find(
        (c) => c.userId === member.user.id && c.date === "2026-10-12",
      )?.status,
    ).toBe("ON_LEAVE");
    await prisma.checklistRun.update({
      where: { id: request.id },
      data: { status: "CANCELLED" },
    });
    expect((await result(member, "attendance")).value).toBe(100);
    expect((await result(owner, "leave")).value).toBe(0);
  });
  it("derives donor retention from distinct adjacent-period cohorts without mixing currency", async () => {
    const ws = owner.workspace.id,
      donor = await prisma.contact.create({
        data: { workspaceId: ws, displayName: "Office supporter" },
      });
    for (const date of ["2026-09-20", "2026-10-10"])
      await prisma.fundingRecord.create({
        data: {
          workspaceId: ws,
          kind: "DONATION",
          title: "Office support gift",
          status: "RECEIVED",
          dateOn: new Date(date),
          contactId: donor.id,
          amountMinor: 1000,
          currency: "INR",
          details: { mode: "BANK" },
        },
      });
    const m = await result(owner, "retention");
    expect(m.value).toBe(100);
    expect(m.count).toBe(1);
    expect((await result(owner, "retention", { currency: "USD" })).count).toBe(
      0,
    );
  });
}
