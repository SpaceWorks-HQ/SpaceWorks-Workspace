import "server-only";

import { NOT_ALLOWED, actionError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { resolveChannel, type ChatContext } from "@/lib/chat/access";
import { canPinMessage } from "@/lib/chat/policy";
import { isAllowedReaction } from "@/lib/chat/reactions";
import type { AttachmentDTO, MessageDTO } from "@/lib/chat/types";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile } from "@/lib/storage";
import { RASTER_IMAGE_TYPES } from "@/lib/storage/policy";

import { MESSAGE_GONE, nudgeUsers, publishChannel } from "./context";
import { oneDTO, resolveMessage } from "./messageAccess";

export async function toggleReaction(ctx: ChatContext, input: { messageId: string; emoji: string }): Promise<ActionResult<{ message: MessageDTO }>> {
  if (!isAllowedReaction(input.emoji)) return actionError("Pick one of the reactions on the list.");
  const found = await resolveMessage(ctx, input.messageId);
  if (!found || found.message.deletedAt) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!resolved.canPost) return actionError("Join the channel to react.");
  const existing = await prisma.messageReaction.findUnique({ where: { messageId_userId_emoji: { messageId: message.id, userId: ctx.user.id, emoji: input.emoji } }, select: { id: true } });
  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.createMany({ data: [{ messageId: message.id, userId: ctx.user.id, emoji: input.emoji }], skipDuplicates: true });
  }
  await publishChannel(ctx, resolved.channel, "message.updated", { messageId: message.id, parentId: message.parentId });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
}

export async function setPinned(ctx: ChatContext, input: { messageId: string; pinned: boolean }): Promise<ActionResult<{ message: MessageDTO }>> {
  const found = await resolveMessage(ctx, input.messageId);
  if (!found || found.message.deletedAt) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!resolved.canPost || !canPinMessage(ctx.membership, message, ctx.user.id, resolved.channel.kind)) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: message.id }, data: input.pinned ? { pinnedAt: new Date(), pinnedById: ctx.user.id } : { pinnedAt: null, pinnedById: null } });
    await recordAuditEvent({ action: input.pinned ? "chat.message_pinned" : "chat.message_unpinned", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Message", targetId: message.id, metadata: { channelId: resolved.channel.id }, client: tx });
  });
  await publishChannel(ctx, resolved.channel, "message.updated", { messageId: message.id, parentId: message.parentId, pinned: input.pinned });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
}

/** Move the read marker to now (never backwards) and tell the member's other tabs. */
export async function markRead(ctx: ChatContext, channelId: string): Promise<ActionResult> {
  const now = new Date();
  const updated = await prisma.channelMember.updateMany({
    where: { channelId, userId: ctx.user.id, channel: { workspaceId: ctx.workspace.id }, OR: [{ lastReadAt: null }, { lastReadAt: { lt: now } }] },
    data: { lastReadAt: now },
  });
  if (updated.count > 0) await nudgeUsers(ctx, [ctx.user.id], "chat.read", { channelId });
  return { ok: true };
}

export async function sendTyping(ctx: ChatContext, channelId: string, parentId: string | null): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.canPost) return { ok: true };
  await publishChannel(ctx, resolved.channel, "typing", { userId: ctx.user.id, name: ctx.user.name?.trim() || "Someone", parentId });
  return { ok: true };
}

export async function uploadAttachment(ctx: ChatContext, channelId: string, file: File): Promise<ActionResult<{ attachment: AttachmentDTO }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.canPost) return actionError("Join the channel to share files.");
  const result = await uploadWorkspaceFile({ workspaceId: ctx.workspace.id, uploadedById: ctx.user.id, file, folder: "/chat" });
  if (!result.ok) return actionError(result.error);
  const stored = result.file;
  return {
    ok: true,
    data: {
      attachment: {
        id: stored.id,
        filename: stored.filename,
        contentType: stored.contentType,
        size: stored.size,
        url: `/api/files/${encodeURIComponent(stored.id)}`,
        downloadUrl: `/api/files/${encodeURIComponent(stored.id)}?download=1`,
        isImage: RASTER_IMAGE_TYPES.has(stored.contentType),
      },
    },
  };
}
