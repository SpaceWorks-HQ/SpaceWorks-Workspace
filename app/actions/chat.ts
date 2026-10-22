"use server";

import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { context, revalidateChat } from "@/lib/chat/action-context";
import {
  channelOnlySchema,
  createSchema,
  updateSchema,
  archiveSchema,
  membersSchema,
  removeSchema,
  notifySchema,
  dmSchema,
  postSchema,
  editSchema,
  messageOnlySchema,
  reactionSchema,
  pinSchema,
  typingSchema,
} from "@/lib/chat/action-validation";
import type { ChannelMemberDTO } from "@/lib/chat/queries";
import * as reads from "@/lib/chat/read-actions";
import * as chat from "@/lib/chat/service";
import type { AttachmentDTO, BrowseChannel, MessageDTO, MessagePage, SearchHit, SidebarData } from "@/lib/chat/types";

/**
 * Chat Server Actions. Pattern: resolve the workspace from the slug
 * server-side → rate limit → validate → lib/chat (which re-checks channel
 * access, writes, audits, dispatches and publishes realtime nudges).
 * Reads are actions too so the client can page and refetch after realtime
 * events; they never trust ids without resolving them inside the workspace.
 */

// ───────────── Reads ─────────────

export async function loadSidebarAction(slug: string): Promise<ActionResult<SidebarData>> {
  return reads.loadSidebarAction(slug);
}

export async function loadMessagesAction(slug: string, input: unknown): Promise<ActionResult<MessagePage>> {
  return reads.loadMessagesAction(slug, input);
}

export async function loadMessagesByIdsAction(slug: string, input: unknown): Promise<ActionResult<MessageDTO[]>> {
  return reads.loadMessagesByIdsAction(slug, input);
}

export async function loadThreadAction(slug: string, input: unknown): Promise<ActionResult<{ root: MessageDTO; replies: MessageDTO[]; hasMore: boolean }>> {
  return reads.loadThreadAction(slug, input);
}

export async function loadPinnedAction(slug: string, input: unknown): Promise<ActionResult<MessageDTO[]>> {
  return reads.loadPinnedAction(slug, input);
}

export async function loadChannelMembersAction(slug: string, input: unknown): Promise<ActionResult<ChannelMemberDTO[]>> {
  return reads.loadChannelMembersAction(slug, input);
}

export async function browseChannelsAction(slug: string, input: unknown): Promise<ActionResult<BrowseChannel[]>> {
  return reads.browseChannelsAction(slug, input);
}

export async function searchMessagesAction(slug: string, input: unknown): Promise<ActionResult<SearchHit[]>> {
  return reads.searchMessagesAction(slug, input);
}

// ───────────── Channels ─────────────

export async function createChannelAction(slug: string, input: unknown): Promise<ActionResult<{ id: string; href: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await chat.createChannel(ctx, parsed.data);
  if (result.ok) revalidateChat(ctx.workspace.slug);
  return result;
}

export async function joinChannelAction(slug: string, input: unknown): Promise<ActionResult<{ href: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = channelOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await chat.joinChannel(ctx, parsed.data.channelId);
  if (result.ok) revalidateChat(ctx.workspace.slug);
  return result;
}

export async function leaveChannelAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = channelOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await chat.leaveChannel(ctx, parsed.data.channelId);
  if (result.ok) revalidateChat(ctx.workspace.slug);
  return result;
}

export async function updateChannelAction(slug: string, input: unknown): Promise<ActionResult<{ href: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { channelId, ...changes } = parsed.data;
  const result = await chat.updateChannel(ctx, channelId, changes);
  if (result.ok) revalidateChat(ctx.workspace.slug);
  return result;
}

export async function setChannelArchivedAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await chat.setChannelArchived(ctx, parsed.data.channelId, parsed.data.archived);
  if (result.ok) revalidateChat(ctx.workspace.slug);
  return result;
}

export async function addChannelMembersAction(slug: string, input: unknown): Promise<ActionResult<{ added: number }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = membersSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.addChannelMembers(ctx, parsed.data.channelId, parsed.data.userIds);
}

export async function removeChannelMemberAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await chat.removeChannelMember(ctx, parsed.data.channelId, parsed.data.userId);
  if (result.ok && parsed.data.userId === ctx.user.id) revalidateChat(ctx.workspace.slug);
  return result;
}

export async function setNotifyLevelAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = notifySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.setNotifyLevel(ctx, parsed.data.channelId, parsed.data.level);
}

export async function openDirectMessageAction(slug: string, input: unknown): Promise<ActionResult<{ id: string; href: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = dmSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.openDirectMessage(ctx, parsed.data.userIds);
}

// ───────────── Messages ─────────────

export async function postMessageAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("message", ctx.user.id)) return actionError("You're sending messages very quickly. Wait a moment and try again.");
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.postMessage(ctx, parsed.data);
}

export async function editMessageAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("message", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.editMessage(ctx, parsed.data);
}

export async function deleteMessageAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("message", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = messageOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.deleteMessage(ctx, parsed.data.messageId);
}

export async function toggleReactionAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.toggleReaction(ctx, parsed.data);
}

export async function setPinnedAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.setPinned(ctx, parsed.data);
}

export async function markReadAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = channelOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.markRead(ctx, parsed.data.channelId);
}

export async function sendTypingAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return { ok: true };
  const parsed = typingSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.sendTyping(ctx, parsed.data.channelId, parsed.data.parentId);
}

export async function uploadChatAttachmentAction(slug: string, formData: FormData): Promise<ActionResult<{ attachment: AttachmentDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("upload", ctx.user.id)) return actionError("You've uploaded a lot of files recently. Try again later.");
  const parsed = channelOnlySchema.safeParse({ channelId: formData.get("channelId") });
  if (!parsed.success) return validationError(parsed.error);
  const file = formData.get("file");
  if (!(file instanceof File)) return actionError("Choose a file to upload.");
  return chat.uploadAttachment(ctx, parsed.data.channelId, file);
}
