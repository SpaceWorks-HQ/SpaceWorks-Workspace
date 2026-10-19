import "server-only";

import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { publish } from "@/lib/realtime";
import { canDeleteShoutout, canGiveShoutouts } from "@/lib/community/access";
import { displayName, type CommunityActor } from "@/lib/community/context";
import { excerpt } from "@/lib/community/richText";
import { shoutoutInputSchema } from "@/lib/community/validation";

/**
 * Shoutouts: a wall of thanks. Members thank anyone in the workspace (not
 * themselves); the person thanked hears about it through
 * `shoutout.received`. The giver or an admin can take one down.
 */

export type ShoutoutFilter = { personId?: string | null; direction?: "received" | "given" };

export async function listShoutouts(actor: CommunityActor, filter: ShoutoutFilter = {}, take = 60) {
  const person = filter.personId ?? null;
  const rows = await prisma.shoutout.findMany({
    where: {
      workspaceId: actor.workspace.id,
      ...(person ? (filter.direction === "given" ? { fromId: person } : { toId: person }) : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 200),
    select: {
      id: true,
      message: true,
      createdAt: true,
      fromId: true,
      from: { select: { id: true, name: true, image: true } },
      to: { select: { id: true, name: true, image: true } },
    },
  });
  return rows.map((row) => ({ ...row, canDelete: canDeleteShoutout(actor.membership, row, actor.user.id) }));
}

/** Shoutouts received per member (for the wall's people list and profiles). */
export async function shoutoutCountsByRecipient(workspaceId: string) {
  const rows = await prisma.shoutout.groupBy({ by: ["toId"], where: { workspaceId }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.toId, row._count._all] as const));
}

export async function giveShoutout(actor: CommunityActor, input: unknown, now = new Date()): Promise<ActionResult<{ id: string }>> {
  if (!canGiveShoutouts(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = shoutoutInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { toId, message } = parsed.data;
  if (toId === actor.user.id) return actionError("Shoutouts are for thanking someone else. Pick another member.", { toId: ["Pick someone else."] });
  const recipient = await prisma.membership.findFirst({
    where: { workspaceId: actor.workspace.id, userId: toId, status: "ACTIVE" },
    select: { user: { select: { name: true } } },
  });
  if (!recipient) return actionError("That person isn't an active member here.", { toId: ["Pick a member of this workspace."] });

  const { shoutout, result } = await prisma.$transaction(async (tx) => {
    const shoutout = await tx.shoutout.create({ data: { workspaceId: actor.workspace.id, fromId: actor.user.id, toId, message } });
    const result = await dispatch(
      actor.workspace.id,
      {
        type: "shoutout.received",
        title: `${displayName(actor.user.name)} gave you a shoutout`.slice(0, 150),
        body: excerpt(message, 300),
        url: `/w/${actor.workspace.slug}/shoutouts?person=${toId}`,
        actorId: actor.user.id,
        recipients: [toId],
        resource: { type: "shoutout", id: shoutout.id },
        data: { shoutoutId: shoutout.id, fromUserId: actor.user.id },
      },
      { tx, now },
    );
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        verb: "thanked",
        entityType: "shoutout",
        entityId: shoutout.id,
        summary: `${displayName(actor.user.name)} gave ${displayName(recipient.user.name)} a shoutout`,
        data: { toId },
      },
      tx,
    );
    await recordAuditEvent({ client: tx, action: "shoutout.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Shoutout", targetId: shoutout.id });
    return { shoutout, result };
  });
  await result.afterCommit();
  await publish(actor.workspace.id, "workspace", { type: "community.shoutout.changed", data: { shoutoutId: shoutout.id } });
  return { ok: true, data: { id: shoutout.id } };
}

export async function deleteShoutout(actor: CommunityActor, id: string): Promise<ActionResult> {
  const row = await prisma.shoutout.findFirst({ where: { id, workspaceId: actor.workspace.id }, select: { id: true, fromId: true } });
  if (!row) return actionError("That shoutout is already gone.");
  if (!canDeleteShoutout(actor.membership, row, actor.user.id)) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async (tx) => {
    await tx.shoutout.delete({ where: { id: row.id } });
    await recordAuditEvent({ client: tx, action: "shoutout.deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Shoutout", targetId: row.id, metadata: { ownShoutout: row.fromId === actor.user.id } });
  });
  await publish(actor.workspace.id, "workspace", { type: "community.shoutout.changed", data: { shoutoutId: row.id } });
  return { ok: true };
}
