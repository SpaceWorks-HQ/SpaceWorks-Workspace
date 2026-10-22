import "server-only";

import { NOT_ALLOWED, actionError, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { channelHref, resolveChannel, type ChatContext } from "@/lib/chat/access";
import {
  canAdministerChannel,
  canCreateChannel,
  canSetTopic,
} from "@/lib/chat/policy";
import { prisma } from "@/lib/db";
import { hiddenTeamIds } from "@/lib/teamAccess";

import { NOT_FOUND, activeMembers, nudgeUsers, publishChannel, uniqueViolation } from "./context";
import { indexChannel } from "./searchIndex";

// ───────────── Channels ─────────────

export async function createChannel(
  ctx: ChatContext,
  input: { name: string; kind: "PUBLIC" | "PRIVATE"; topic: string; teamId: string | null; memberIds: string[] },
): Promise<ActionResult<{ href: string; id: string }>> {
  if (!canCreateChannel(ctx.membership, input.kind)) {
    return actionError(input.kind === "PUBLIC" ? "Only admins can create public channels. Create a private channel instead." : NOT_ALLOWED);
  }
  if (input.teamId) {
    const team = await prisma.team.findFirst({ where: { id: input.teamId, workspaceId: ctx.workspace.id, archivedAt: null }, select: { id: true } });
    const hidden = await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role });
    if (!team || hidden.includes(team.id)) return actionError("Pick a team you belong to.");
  }
  const invited = input.kind === "PRIVATE" ? (await activeMembers(ctx, input.memberIds)).map((m) => m.userId).filter((id) => id !== ctx.user.id) : [];
  try {
    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          workspaceId: ctx.workspace.id,
          name: input.name,
          slug: input.name,
          kind: input.kind,
          topic: input.topic || null,
          teamId: input.teamId,
          createdById: ctx.user.id,
          members: { create: [{ userId: ctx.user.id }, ...invited.map((userId) => ({ userId }))] },
        },
      });
      await indexChannel(tx, ctx, created);
      await recordAuditEvent({ action: "chat.channel_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: created.id, metadata: { kind: created.kind, invited: invited.length }, client: tx });
      if (created.kind === "PUBLIC") {
        await recordActivity({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, verb: "created", entityType: "channel", entityId: created.id, summary: `Started #${created.name}`, teamId: created.teamId }, tx);
      }
      return created;
    });
    await nudgeUsers(ctx, invited, "chat.membership", { channelId: channel.id, added: true });
    return { ok: true, data: { id: channel.id, href: channelHref(ctx.workspace.slug, channel) } };
  } catch (error) {
    if (uniqueViolation(error)) return actionError("A channel with that name already exists. Pick another name.", { name: ["A channel with that name already exists."] });
    throw error;
  }
}

export async function updateChannel(
  ctx: ChatContext,
  channelId: string,
  input: { name?: string; topic?: string; isDefault?: boolean },
): Promise<ActionResult<{ href: string }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (channel.kind === "DIRECT") return actionError(NOT_ALLOWED);
  if (channel.archivedAt) return actionError("This channel is archived. Unarchive it first.");
  const wantsAdmin = input.name !== undefined || input.isDefault !== undefined;
  if (wantsAdmin && !canAdministerChannel(ctx.membership)) return actionError(NOT_ALLOWED);
  if (input.topic !== undefined && !canSetTopic(ctx.membership, Boolean(resolved.member), channel.kind)) return actionError(NOT_ALLOWED);
  if (input.isDefault && channel.kind !== "PUBLIC") return actionError("Only public channels can be default channels.");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.channel.update({
        where: { id: channel.id },
        data: {
          ...(input.name !== undefined ? { name: input.name, slug: input.name } : {}),
          ...(input.topic !== undefined ? { topic: input.topic || null } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        },
      });
      await indexChannel(tx, ctx, row);
      await recordAuditEvent({
        action: "chat.channel_updated",
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        targetType: "Channel",
        targetId: row.id,
        metadata: { renamed: input.name !== undefined && input.name !== channel.name, topic: input.topic !== undefined, isDefault: input.isDefault ?? null },
        client: tx,
      });
      return row;
    });
    await publishChannel(ctx, updated, "channel.updated", {});
    return { ok: true, data: { href: channelHref(ctx.workspace.slug, updated) } };
  } catch (error) {
    if (uniqueViolation(error)) return actionError("A channel with that name already exists. Pick another name.", { name: ["A channel with that name already exists."] });
    throw error;
  }
}

export async function setChannelArchived(ctx: ChatContext, channelId: string, archived: boolean): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (channel.kind === "DIRECT" || !canAdministerChannel(ctx.membership)) return actionError(NOT_ALLOWED);
  if (Boolean(channel.archivedAt) === archived) return { ok: true };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.channel.update({ where: { id: channel.id }, data: { archivedAt: archived ? new Date() : null, ...(archived ? { isDefault: false } : {}) } });
    await indexChannel(tx, ctx, row);
    await recordAuditEvent({ action: archived ? "chat.channel_archived" : "chat.channel_unarchived", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: row.id, client: tx });
    if (row.kind === "PUBLIC") {
      await recordActivity({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, verb: archived ? "archived" : "unarchived", entityType: "channel", entityId: row.id, summary: `${archived ? "Archived" : "Unarchived"} #${row.name}`, teamId: row.teamId }, tx);
    }
    return row;
  });
  await publishChannel(ctx, updated, "channel.updated", { archived });
  return { ok: true };
}
