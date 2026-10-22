import "server-only";

import { NOT_ALLOWED, actionError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { channelHref, resolveChannel, type ChatContext } from "@/lib/chat/access";
import { MAX_DM_PARTICIPANTS, dmKey, dmParticipants } from "@/lib/chat/dm";
import {
  canAddMembers,
  canJoinPublic,
  canRemoveMember,
  canStartDirectMessage,
} from "@/lib/chat/policy";
import { prisma } from "@/lib/db";
import { type NotifyLevel } from "@prisma/client";
import { createHash } from "crypto";

import { NOT_FOUND, activeMembers, nudgeUsers, publishChannel, uniqueViolation } from "./context";

export async function joinChannel(ctx: ChatContext, channelId: string): Promise<ActionResult<{ href: string }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (resolved.member) return { ok: true, data: { href: channelHref(ctx.workspace.slug, channel) } };
  if (channel.kind !== "PUBLIC" || channel.archivedAt || !canJoinPublic(ctx.membership)) return actionError(NOT_ALLOWED);
  await prisma.channelMember.createMany({ data: [{ channelId: channel.id, userId: ctx.user.id, lastReadAt: new Date() }], skipDuplicates: true });
  await publishChannel(ctx, channel, "channel.members", { userId: ctx.user.id, joined: true });
  await nudgeUsers(ctx, [ctx.user.id], "chat.membership", { channelId: channel.id, added: true });
  return { ok: true, data: { href: channelHref(ctx.workspace.slug, channel) } };
}

export async function leaveChannel(ctx: ChatContext, channelId: string): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.member) return actionError(NOT_FOUND);
  if (resolved.channel.kind === "DIRECT") return actionError("You can't leave a direct message. Mute it instead.");
  await prisma.channelMember.deleteMany({ where: { channelId: resolved.channel.id, userId: ctx.user.id } });
  await publishChannel(ctx, resolved.channel, "channel.members", { userId: ctx.user.id, joined: false });
  await nudgeUsers(ctx, [ctx.user.id], "chat.membership", { channelId: resolved.channel.id, added: false });
  return { ok: true };
}

export async function addChannelMembers(ctx: ChatContext, channelId: string, userIds: string[]): Promise<ActionResult<{ added: number }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (channel.archivedAt || !canAddMembers(ctx.membership, Boolean(resolved.member), channel.kind)) return actionError(NOT_ALLOWED);
  const targets = (await activeMembers(ctx, userIds)).map((m) => m.userId);
  if (targets.length === 0) return actionError("Pick at least one active member.");
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.channelMember.createMany({ data: targets.map((userId) => ({ channelId: channel.id, userId })), skipDuplicates: true });
    await recordAuditEvent({ action: "chat.member_added", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: channel.id, metadata: { count: created.count }, client: tx });
    return created;
  });
  await publishChannel(ctx, channel, "channel.members", { joined: true });
  await nudgeUsers(ctx, targets, "chat.membership", { channelId: channel.id, added: true });
  return { ok: true, data: { added: result.count } };
}

export async function removeChannelMember(ctx: ChatContext, channelId: string, userId: string): Promise<ActionResult> {
  if (userId === ctx.user.id) return leaveChannel(ctx, channelId);
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (!canRemoveMember(ctx.membership, ctx.user.id, channel)) return actionError(NOT_ALLOWED);
  const removed = await prisma.$transaction(async (tx) => {
    const row = await tx.channelMember.deleteMany({ where: { channelId: channel.id, userId } });
    if (row.count > 0) {
      await recordAuditEvent({ action: "chat.member_removed", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: channel.id, metadata: { userId }, client: tx });
    }
    return row.count;
  });
  if (removed === 0) return actionError("That person isn't in this channel.");
  await publishChannel(ctx, channel, "channel.members", { joined: false });
  await nudgeUsers(ctx, [userId], "chat.membership", { channelId: channel.id, added: false });
  return { ok: true };
}

export async function setNotifyLevel(ctx: ChatContext, channelId: string, level: NotifyLevel): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.member) return actionError("Join the channel to change its notifications.");
  await prisma.channelMember.update({ where: { channelId_userId: { channelId: resolved.channel.id, userId: ctx.user.id } }, data: { notify: level } });
  await nudgeUsers(ctx, [ctx.user.id], "chat.read", { channelId: resolved.channel.id });
  return { ok: true };
}

/** Find or create the DM for this group of people (yourself included). */
export async function openDirectMessage(ctx: ChatContext, otherIds: string[]): Promise<ActionResult<{ id: string; href: string }>> {
  if (!canStartDirectMessage(ctx.membership)) return actionError(NOT_ALLOWED);
  const wanted = [...new Set(otherIds.filter((id) => id !== ctx.user.id))];
  if (wanted.length > MAX_DM_PARTICIPANTS - 1) return actionError(`A direct message can include up to ${MAX_DM_PARTICIPANTS - 1} other people.`);
  const others = (await activeMembers(ctx, wanted, "MEMBER")).map((m) => m.userId);
  if (others.length !== wanted.length) return actionError("Some of those people can't receive direct messages. Pick active members.");
  const participants = dmParticipants(ctx.user.id, others);
  const key = dmKey(ctx.workspace.id, participants);
  const existing = await prisma.channel.findUnique({ where: { dmKey: key }, select: { id: true, workspaceId: true } });
  if (existing && existing.workspaceId === ctx.workspace.id) return { ok: true, data: { id: existing.id, href: `/w/${ctx.workspace.slug}/dm/${existing.id}` } };
  try {
    const created = await prisma.channel.create({
      data: {
        workspaceId: ctx.workspace.id,
        kind: "DIRECT",
        name: "Direct message",
        slug: `dm-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
        dmKey: key,
        createdById: ctx.user.id,
        members: { create: participants.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return { ok: true, data: { id: created.id, href: `/w/${ctx.workspace.slug}/dm/${created.id}` } };
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const raced = await prisma.channel.findUnique({ where: { dmKey: key }, select: { id: true } });
    if (!raced) throw error;
    return { ok: true, data: { id: raced.id, href: `/w/${ctx.workspace.slug}/dm/${raced.id}` } };
  }
}
