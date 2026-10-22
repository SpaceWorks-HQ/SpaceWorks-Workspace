import "server-only";

import { NOT_ALLOWED, actionError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { resolveChannel, type ChatContext } from "@/lib/chat/access";
import {
  MAX_ATTACHMENTS,
  canDeleteMessage,
  canEditMessage,
} from "@/lib/chat/policy";
import { extractUserMentions, hasBroadcastMention } from "@/lib/chat/text";
import type { MessageDTO } from "@/lib/chat/types";
import { prisma } from "@/lib/db";
import { removeSearchDocument } from "@/lib/search/documents";

import { MESSAGE_GONE, NOT_FOUND, publishChannel } from "./context";
import { oneDTO, prepareBody, resolveMessage } from "./messageAccess";
import { notifyForMessage } from "./notifications";
import { indexMessage } from "./searchIndex";

export async function postMessage(
  ctx: ChatContext,
  input: { channelId: string; body: string; parentId: string | null; attachmentIds: string[] },
): Promise<ActionResult<{ message: MessageDTO }>> {
  const resolved = await resolveChannel(ctx, { id: input.channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (!resolved.canPost) {
    return actionError(channel.archivedAt ? "This channel is archived, so it's read-only." : "Join the channel to post here.");
  }
  const prepared = await prepareBody(ctx, channel, input.body);
  if ("error" in prepared) return actionError(prepared.error);
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (!prepared.body && attachmentIds.length === 0) return actionError("Write a message or attach a file.");
  if (attachmentIds.length > MAX_ATTACHMENTS) return actionError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);

  let parent: { id: string; authorId: string | null } | null = null;
  if (input.parentId) {
    parent = await prisma.message.findFirst({ where: { id: input.parentId, channelId: channel.id, parentId: null, deletedAt: null }, select: { id: true, authorId: true } });
    if (!parent) return actionError("That thread isn't available any more.");
  }
  if (attachmentIds.length > 0) {
    const files = await prisma.fileObject.count({
      where: {
        id: { in: attachmentIds },
        workspaceId: ctx.workspace.id,
        uploadedById: ctx.user.id,
        deletedAt: null,
        messageAttachments: { none: {} },
        createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
      },
    });
    if (files !== attachmentIds.length) return actionError("Some attachments are no longer available. Upload them again.");
  }

  const now = new Date();
  const mentioned = extractUserMentions(prepared.body);
  const broadcast = hasBroadcastMention(prepared.body);
  const actorName = ctx.user.name?.trim() || "Someone";

  const { id, dispatches } = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        workspaceId: ctx.workspace.id,
        channelId: channel.id,
        authorId: ctx.user.id,
        body: prepared.body,
        parentId: parent?.id ?? null,
        createdAt: now,
        attachments: attachmentIds.length ? { create: attachmentIds.map((fileId) => ({ fileId })) } : undefined,
      },
      select: { id: true, parentId: true, body: true },
    });
    if (parent) {
      await tx.message.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 }, lastReplyAt: now } });
    } else {
      await tx.channel.update({ where: { id: channel.id }, data: { lastMessageAt: now } });
    }
    await tx.channelMember.updateMany({ where: { channelId: channel.id, userId: ctx.user.id, OR: [{ lastReadAt: null }, { lastReadAt: { lt: now } }] }, data: { lastReadAt: now } });
    await indexMessage(tx, ctx, channel, message, actorName);
    const results = await notifyForMessage(tx, ctx, resolved, { id: message.id, body: message.body, parentId: message.parentId, parentAuthorId: parent?.authorId ?? null, mentioned, broadcast });
    return { id: message.id, dispatches: results };
  });

  for (const result of dispatches) await result.afterCommit();
  await publishChannel(ctx, channel, "message.created", { messageId: id, parentId: parent?.id ?? null });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, id) } };
}

export async function editMessage(ctx: ChatContext, input: { messageId: string; body: string }): Promise<ActionResult<{ message: MessageDTO }>> {
  const found = await resolveMessage(ctx, input.messageId);
  if (!found) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!canEditMessage(message, ctx.user.id)) return actionError("You can only edit your own messages.");
  if (resolved.channel.archivedAt) return actionError("This channel is archived, so it's read-only.");
  const prepared = await prepareBody(ctx, resolved.channel, input.body);
  if ("error" in prepared) return actionError(prepared.error);
  if (!prepared.body) {
    const attachments = await prisma.messageAttachment.count({ where: { messageId: message.id } });
    if (attachments === 0) return actionError("A message can't be empty. Delete it instead.");
  }
  if (prepared.body === message.body) return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.message.update({ where: { id: message.id }, data: { body: prepared.body, editedAt: new Date() }, select: { id: true, parentId: true, body: true } });
    await indexMessage(tx, ctx, resolved.channel, updated, ctx.user.name?.trim() || "Someone");
  });
  await publishChannel(ctx, resolved.channel, "message.updated", { messageId: message.id, parentId: message.parentId });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
}

export async function deleteMessage(ctx: ChatContext, messageId: string): Promise<ActionResult> {
  const found = await resolveMessage(ctx, messageId);
  if (!found) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!canDeleteMessage(ctx.membership, message, ctx.user.id, resolved.channel.kind)) return actionError(NOT_ALLOWED);
  const moderated = message.authorId !== ctx.user.id;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.message.updateMany({ where: { id: message.id, deletedAt: null }, data: { deletedAt: new Date(), pinnedAt: null, pinnedById: null } });
    if (updated.count === 0) return;
    if (message.parentId) {
      await tx.message.updateMany({ where: { id: message.parentId, replyCount: { gt: 0 } }, data: { replyCount: { decrement: 1 } } });
    }
    await tx.messageReaction.deleteMany({ where: { messageId: message.id } });
    await removeSearchDocument("message", message.id, tx);
    await recordAuditEvent({
      action: "chat.message_deleted",
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      targetType: "Message",
      targetId: message.id,
      metadata: { channelId: resolved.channel.id, moderated },
      client: tx,
    });
  });
  await publishChannel(ctx, resolved.channel, "message.deleted", { messageId: message.id, parentId: message.parentId });
  return { ok: true };
}
