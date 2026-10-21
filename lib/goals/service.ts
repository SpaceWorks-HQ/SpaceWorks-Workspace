import "server-only";
import { visibleProjectWhere, visibleTaskWhere } from "@/lib/tasks/access";
import {
  type Actor,
  assertActor,
  ensure,
  changed,
  serial,
  checkMembers,
  checkTeam,
} from "@/lib/meetings/core";
import { goalCommand } from "./goal-command";
import { goalWhere } from "./goal-access";

export { goalCommand } from "./goal-command";
export { goalWhere } from "./goal-access";

export async function mutateGoal(actor: Actor, input: unknown) {
  const data = goalCommand.parse(input);
  return serial(async (tx) => {
    await assertActor(actor, tx);
    if (data.op === "create") {
      ensure(
        data.periodEnd > data.periodStart,
        "Choose an end date after the start.",
      );
      await checkTeam(actor, data.teamId, tx);
      await checkMembers(
        actor,
        [data.ownerId ?? actor.user.id],
        tx,
        data.teamId,
      );
      ensure(
        await tx.membership.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            userId: data.ownerId ?? actor.user.id,
            status: "ACTIVE",
            role: { in: ["MEMBER", "ADMIN", "OWNER"] },
          },
        }),
        "Choose a contributor to own this objective.",
      );
      if (data.parentGoalId)
        ensure(
          await tx.goal.findFirst({
            where: {
              ...(await goalWhere(actor, tx)),
              id: data.parentGoalId,
              teamId: data.teamId ?? null,
            },
          }),
        );
      const goal = await tx.goal.create({
        data: {
          workspaceId: actor.workspace.id,
          title: data.title,
          description: data.description,
          ownerId: data.ownerId ?? actor.user.id,
          teamId: data.teamId,
          parentGoalId: data.parentGoalId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
        },
      });
      await changed(
        tx,
        actor,
        "goal",
        goal.id,
        goal.title,
        `goals/${goal.id}`,
        "created",
        data.description,
        { teamId: goal.teamId },
      );
      return { id: goal.id };
    }
    const goal = await tx.goal.findFirst({
      where: { ...(await goalWhere(actor, tx)), id: data.goalId },
    });
    ensure(goal);
    ensure(
      goal.ownerId === actor.user.id ||
        actor.membership.role === "ADMIN" ||
        actor.membership.role === "OWNER",
      "Only the objective owner or an admin can update it.",
    );
    if (data.op === "edit") {
      ensure(
        data.periodEnd > data.periodStart,
        "Choose an end date after the start.",
      );
      await checkMembers(actor, [data.ownerId], tx, goal.teamId);
      ensure(
        await tx.membership.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            userId: data.ownerId,
            status: "ACTIVE",
            role: { in: ["MEMBER", "ADMIN", "OWNER"] },
          },
        }),
        "Choose a contributor to own this objective.",
      );
      await tx.goal.updateMany({
        where: { workspaceId: actor.workspace.id, id: goal.id },
        data: {
          title: data.title,
          description: data.description,
          ownerId: data.ownerId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
        },
      });
      await changed(
        tx,
        actor,
        "goal",
        goal.id,
        data.title,
        `goals/${goal.id}`,
        "updated",
        data.description,
        { teamId: goal.teamId, ownerId: data.ownerId },
      );
      return { id: goal.id };
    } else if (data.op === "result") {
      ensure(
        data.metricType !== "PERCENT" ||
          (data.start >= 0 &&
            data.start <= 100 &&
            data.target >= 0 &&
            data.target <= 100),
        "Percent values must be between 0 and 100.",
      );
      ensure(
        data.metricType === "BOOLEAN" || data.start !== data.target,
        "Choose a target different from the starting value.",
      );
      const count = await tx.keyResult.count({
        where: { goalId: goal.id, goal: { workspaceId: actor.workspace.id } },
      });
      await tx.keyResult.create({
        data: {
          goalId: goal.id,
          title: data.title,
          metricType: data.metricType,
          start: data.metricType === "BOOLEAN" ? 0 : data.start,
          target: data.metricType === "BOOLEAN" ? 1 : data.target,
          current: data.metricType === "BOOLEAN" ? 0 : data.start,
          sortOrder: count,
        },
      });
    } else if (data.op === "checkin") {
      const result = await tx.keyResult.findFirst({
        where: {
          id: data.resultId,
          goalId: goal.id,
          goal: { workspaceId: actor.workspace.id },
        },
      });
      ensure(result);
      ensure(
        result.metricType !== "BOOLEAN" || [0, 1].includes(data.value),
        "Use 0 for incomplete or 1 for complete.",
      );
      ensure(
        result.metricType !== "PERCENT" ||
          (data.value >= 0 && data.value <= 100),
        "Percent values must be between 0 and 100.",
      );
      const checkIns = Array.isArray(result.checkIns) ? result.checkIns : [];
      await tx.keyResult.update({
        where: { id: result.id },
        data: {
          current: data.value,
          checkIns: [
            ...checkIns,
            {
              at: new Date().toISOString(),
              value: data.value,
              note: data.note,
              by: actor.user.id,
              confidence: data.confidence,
            },
          ].slice(-500),
        },
      });
      await tx.goal.updateMany({
        where: { workspaceId: actor.workspace.id, id: goal.id },
        data: {
          lastCheckInAt: new Date(),
          status:
            data.confidence === "LOW"
              ? "OFF_TRACK"
              : data.confidence === "MEDIUM"
                ? "AT_RISK"
                : "ON_TRACK",
        },
      });
    } else if (data.op === "status") {
      await tx.goal.updateMany({
        where: { workspaceId: actor.workspace.id, id: goal.id },
        data: { status: data.status },
      });
    } else {
      const target =
        data.type === "task"
          ? await tx.task.findFirst({
              where: {
                AND: [
                  await visibleTaskWhere(actor, tx),
                  { id: data.targetId, archivedAt: null },
                ],
              },
              include: { project: true },
            })
          : await tx.project.findFirst({
              where: {
                AND: [
                  await visibleProjectWhere(actor, tx),
                  { id: data.targetId, status: { not: "ARCHIVED" } },
                ],
              },
            });
      ensure(target);
      await tx.recordLink.upsert({
        where: {
          workspaceId_fromType_fromId_toType_toId: {
            workspaceId: actor.workspace.id,
            fromType: "goal",
            fromId: goal.id,
            toType: data.type,
            toId: data.targetId,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          fromType: "goal",
          fromId: goal.id,
          toType: data.type,
          toId: data.targetId,
          createdById: actor.user.id,
        },
        update: {},
      });
    }
    await changed(
      tx,
      actor,
      "goal",
      goal.id,
      goal.title,
      `goals/${goal.id}`,
      data.op,
      goal.description ?? "",
      { teamId: goal.teamId },
    );
    return { id: goal.id };
  });
}
