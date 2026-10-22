import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { nextWorkspaceSequence } from "@/lib/counters";
import { GovernanceError, type Actor } from "@/lib/governance/service";
import { caseSchema, eventSchema, caseStatuses } from "../rules";
import { caseLock, caseAccess, activeHandlers } from "./access";
import { audit } from "./audit";

export async function createCase(actor: Actor, raw: unknown) {
  const input = caseSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const grants = await activeHandlers(actor, tx);
    const ids = [...new Set(input.handlerIds)];
    if (
      !ids.includes(actor.user.id) ||
      ids.some((id) => !grants.some((g) => g.userId === id))
    )
      throw new GovernanceError(
        "Cases must include you and currently appointed committee handlers.",
      );
    const row = await tx.safeguardingCase.create({
      data: {
        workspaceId: actor.workspace.id,
        number: await nextWorkspaceSequence(
          tx,
          actor.workspace.id,
          "safeguarding",
        ),
        kind: input.kind,
        handlerIds: ids,
        receivedOn: new Date(input.receivedOn),
        dueOn: new Date(input.dueOn),
        detailsEnc: encryptSecret("safeguarding-details", input.details),
        createdById: actor.user.id,
      },
    });
    await audit(actor, tx, "created", row.id);
    return { id: row.id };
  });
}
export async function addCaseEvent(actor: Actor, raw: unknown) {
  const input = eventSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const row = await caseAccess(actor, input.caseId, tx);
    if (row.closedAt)
      throw new GovernanceError(
        "This case is closed. Retain its outcome and create a new case for further concerns.",
      );
    if (input.kind === "ACTION") {
      const handlers = await activeHandlers(actor, tx);
      if (
        !row.handlerIds.includes(input.ownerId) ||
        !handlers.some((h) => h.userId === input.ownerId)
      )
        throw new GovernanceError("Choose a designated handler on this case.");
    }
    await tx.safeguardingEvent.create({
      data: {
        workspaceId: actor.workspace.id,
        caseId: row.id,
        kind: input.kind,
        bodyEnc: encryptSecret("safeguarding-event", input.body),
        ownerId: input.kind === "ACTION" ? input.ownerId : null,
        dueOn: input.kind === "ACTION" && input.dueOn ? new Date(input.dueOn) : null,
        actorId: actor.user.id,
      },
    });
    await audit(actor, tx, "timeline_added", row.id);
  });
}
export async function updateCase(actor: Actor, raw: unknown) {
  const input = z
    .object({
      caseId: z.string().min(1).max(64),
      status: z.enum(caseStatuses),
      dueOn: z.string().optional(),
      handlerIds: z.array(z.string().min(1).max(64)).min(1).max(12).optional(),
    })
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const row = await caseAccess(actor, input.caseId, tx);
    if (row.closedAt)
      throw new GovernanceError("Closed case records are locked.");
    if (input.status === "CLOSED") {
      if (
        (await tx.safeguardingEvent.count({
          where: {
            workspaceId: actor.workspace.id,
            caseId: row.id,
            kind: "ACTION",
            completedAt: null,
          },
        })) ||
        !(await tx.safeguardingEvent.count({
          where: {
            workspaceId: actor.workspace.id,
            caseId: row.id,
            kind: "OUTCOME",
          },
        }))
      )
        throw new GovernanceError(
          "Complete every action and record an outcome before closing.",
        );
    }
    if (input.handlerIds) {
      const grants = await activeHandlers(actor, tx);
      if (
        !input.handlerIds.includes(actor.user.id) ||
        input.handlerIds.some((id) => !grants.some((g) => g.userId === id))
      )
        throw new GovernanceError(
          "Keep yourself and only current appointed handlers on this case.",
        );
    }
    const dueOn = input.dueOn
      ? caseSchema.shape.dueOn.parse(input.dueOn)
      : undefined;
    if (dueOn && dueOn < row.receivedOn.toISOString().slice(0, 10))
      throw new GovernanceError("Due date must be on or after receipt.");
    await tx.safeguardingCase.update({
      where: {
        workspaceId_id: { workspaceId: actor.workspace.id, id: row.id },
      },
      data: {
        status: input.status,
        closedAt: input.status === "CLOSED" ? new Date() : null,
        ...(dueOn ? { dueOn: new Date(dueOn) } : {}),
        ...(input.handlerIds
          ? { handlerIds: [...new Set(input.handlerIds)] }
          : {}),
      },
    });
    await audit(actor, tx, "updated", row.id);
  });
}
export async function completeCaseAction(
  actor: Actor,
  caseId: string,
  eventId: string,
) {
  return prisma.$transaction(async (tx) => {
    await caseLock(actor, tx);
    const row = await caseAccess(actor, caseId, tx);
    if (row.closedAt)
      throw new GovernanceError("Closed case records are locked.");
    const changed = await tx.safeguardingEvent.updateMany({
      where: {
        workspaceId: actor.workspace.id,
        caseId,
        id: eventId,
        kind: "ACTION",
        completedAt: null,
      },
      data: { completedAt: new Date() },
    });
    if (!changed.count)
      throw new GovernanceError(
        "That action is unavailable. Refresh the case.",
      );
    await audit(actor, tx, "action_completed", caseId);
  });
}
