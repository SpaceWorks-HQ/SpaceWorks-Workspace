import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutateGoal } from "@/lib/goals/service";
import { owner, member, outsider, records } from "./fixtures";

export function registerGoalCheckInTests() {
  it("records confidence-bearing OKR check-ins and rejects foreign results", async () => {
    records.goalId = (
      await mutateGoal(owner, {
        op: "create",
        title: "Make repair easier",
        periodStart: new Date("2026-10-01"),
        periodEnd: new Date("2026-12-31"),
        ownerId: member.user.id,
      })
    ).id;
    await mutateGoal(member, {
      op: "result",
      goalId: records.goalId,
      title: "Repair sessions",
      metricType: "NUMBER",
      start: 0,
      target: 10,
    });
    const result = await prisma.keyResult.findFirstOrThrow({
      where: { goalId: records.goalId },
    });
    await mutateGoal(member, {
      op: "checkin",
      goalId: records.goalId,
      resultId: result.id,
      value: 4,
      note: "Four sessions complete",
      confidence: "MEDIUM",
    });
    expect(
      await prisma.goal.findUnique({ where: { id: records.goalId } }),
    ).toMatchObject({ status: "AT_RISK" });
    expect(
      await prisma.keyResult.findUnique({ where: { id: result.id } }),
    ).toMatchObject({
      current: 4,
      checkIns: [{ confidence: "MEDIUM", by: member.user.id }],
    });
    await expect(
      mutateGoal(outsider, {
        op: "checkin",
        goalId: records.goalId,
        resultId: result.id,
        value: 9,
        confidence: "HIGH",
      }),
    ).rejects.toThrow();
  });
}
