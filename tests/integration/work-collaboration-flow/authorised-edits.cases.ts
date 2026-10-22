import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutateCycle } from "@/lib/cycles/service";
import { mutateGoal } from "@/lib/goals/service";
import { mutateIdea } from "@/lib/ideas/service";
import { mutateTemplate } from "@/lib/templates/service";
import {
  owner,
  member,
  guest,
  outsider,
  startsAt,
  endsAt,
  records,
} from "./fixtures";

export function registerAuthorisedEditTests() {
  it("allows authorised edits while keeping completed history and source ownership intact", async () => {
    await mutateCycle(owner, {
      op: "edit",
      cycleId: records.nextCycleId,
      name: "Next build cycle",
      goal: "Keep the repair work moving",
      startsAt,
      endsAt,
    });
    await expect(
      mutateCycle(owner, {
        op: "edit",
        cycleId: records.cycleId,
        name: "Rewrite history",
        startsAt,
        endsAt,
      }),
    ).rejects.toThrow();
    await mutateCycle(owner, {
      op: "review",
      cycleId: records.cycleId,
      review: "The carry-over is ready for the next build.",
    });
    await mutateGoal(member, {
      op: "edit",
      goalId: records.goalId,
      title: "Make repair easier together",
      ownerId: member.user.id,
      periodStart: new Date("2026-10-01"),
      periodEnd: new Date("2026-12-31"),
    });
    const idea = await mutateIdea(member, {
      op: "create",
      title: "Maker guide",
    });
    await mutateIdea(member, {
      op: "edit",
      ideaId: idea.id,
      title: "First-time maker guide",
      bodyMd: "Start with safety and shared tools.",
    });
    await expect(
      mutateIdea(outsider, {
        op: "edit",
        ideaId: idea.id,
        title: "Foreign edit",
      }),
    ).rejects.toThrow();
    const template = await mutateTemplate(member, {
      op: "create",
      kind: "DOC",
      name: "Guide",
      title: "A maker guide",
      text: "Start here",
    });
    await mutateTemplate(member, {
      op: "edit",
      templateId: template.id,
      name: "Maker guide",
      title: "Welcome {{author}}",
      text: "Start with the shared tools.",
    });
    await expect(
      mutateTemplate(guest, {
        op: "edit",
        templateId: template.id,
        name: "Guest edit",
        title: "Guest edit",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.template.findUnique({ where: { id: template.id } }),
    ).toMatchObject({
      createdById: member.user.id,
      kind: "DOC",
      name: "Maker guide",
    });
  });
}
