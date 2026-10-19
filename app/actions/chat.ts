"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { getWorkspaceForAction } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { resolveChannel, type ChatContext } from "@/lib/chat/access";
import { clampLimit, decodeCursor } from "@/lib/chat/cursor";
import { channelNameSchema, MAX_ATTACHMENTS, messageBodySchema, notifyLevelSchema, topicSchema } from "@/lib/chat/policy";
import {
  browseChannels,
  getSidebar,
  listAround,
  listChannelMembers,
  listMessages,
  listPinned,
  listThread,
  messagesByIds,
  searchMessages,
  type ChannelMemberDTO,
} from "@/lib/chat/queries";
import * as chat from "@/lib/chat/service";
import type { AttachmentDTO, BrowseChannel, MessageDTO, MessagePage, SearchHit, SidebarData } from "@/lib/chat/types";

/**
 * Chat Server Actions. Pattern: resolve the workspace from the slug
 * server-side → rate limit → validate → lib/chat (which re-checks channel
 * access, writes, audits, dispatches and publishes realtime nudges).
 * Reads are actions too so the client can page and refetch after realtime
 * events; they never trust ids without resolving them inside the workspace.
 */

const slugSchema = z.string().min(1).max(64);
const NOT_AVAILABLE = "That conversation isn't available.";

async function context(slug: unknown): Promise<ChatContext | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getWorkspaceForAction(parsed.data, "GUEST");
}

function revalidateChat(slug: string) {
  revalidatePath(`/w/${slug}/chat`, "layout");
  revalidatePath(`/w/${slug}/dm`, "layout");
}

// ───────────── Reads ─────────────

export async function loadSidebarAction(slug: string): Promise<ActionResult<SidebarData>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  return { ok: true, data: await getSidebar(ctx) };
}

const pageSchema = z.object({
  channelId: idSchema,
  before: z.string().max(200).optional(),
  after: z.string().max(200).optional(),
  around: idSchema.optional(),
  limit: z.number().int().optional(),
});

export async function loadMessagesAction(slug: string, input: unknown): Promise<ActionResult<MessagePage>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = pageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const resolved = await resolveChannel(ctx, { id: parsed.data.channelId });
  if (!resolved) return actionError(NOT_AVAILABLE);
  const limit = clampLimit(parsed.data.limit);
  if (parsed.data.around) {
    const page = await listAround(ctx, resolved, parsed.data.around, limit);
    if (page) return { ok: true, data: page };
  }
  return {
    ok: true,
    data: await listMessages(ctx, resolved, { before: decodeCursor(parsed.data.before), after: decodeCursor(parsed.data.after), limit }),
  };
}

const byIdsSchema = z.object({ channelId: idSchema, ids: z.array(idSchema).min(1).max(50) });

export async function loadMessagesByIdsAction(slug: string, input: unknown): Promise<ActionResult<MessageDTO[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = byIdsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const resolved = await resolveChannel(ctx, { id: parsed.data.channelId });
  if (!resolved) return actionError(NOT_AVAILABLE);
  return { ok: true, data: await messagesByIds(ctx, resolved, parsed.data.ids) };
}

const threadSchema = z.object({ channelId: idSchema, parentId: idSchema, after: z.string().max(200).optional() });

export async function loadThreadAction(slug: string, input: unknown): Promise<ActionResult<{ root: MessageDTO; replies: MessageDTO[]; hasMore: boolean }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = threadSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const resolved = await resolveChannel(ctx, { id: parsed.data.channelId });
  if (!resolved) return actionError(NOT_AVAILABLE);
  const thread = await listThread(ctx, resolved, parsed.data.parentId, { after: decodeCursor(parsed.data.after), limit: 100 });
  if (!thread) return actionError("That thread isn't available any more.");
  return { ok: true, data: thread };
}

const channelOnlySchema = z.object({ channelId: idSchema });

export async function loadPinnedAction(slug: string, input: unknown): Promise<ActionResult<MessageDTO[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = channelOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const resolved = await resolveChannel(ctx, { id: parsed.data.channelId });
  if (!resolved) return actionError(NOT_AVAILABLE);
  return { ok: true, data: await listPinned(ctx, resolved) };
}

export async function loadChannelMembersAction(slug: string, input: unknown): Promise<ActionResult<ChannelMemberDTO[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = channelOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const resolved = await resolveChannel(ctx, { id: parsed.data.channelId });
  if (!resolved) return actionError(NOT_AVAILABLE);
  return { ok: true, data: await listChannelMembers(resolved) };
}

export async function browseChannelsAction(slug: string, input: unknown): Promise<ActionResult<BrowseChannel[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = z.object({ includeArchived: z.boolean().optional() }).safeParse(input ?? {});
  if (!parsed.success) return validationError(parsed.error);
  return { ok: true, data: await browseChannels(ctx, parsed.data) };
}

const searchSchema = z.object({ query: z.string().trim().min(2, "Type at least two characters.").max(200), channelId: idSchema.optional() });

export async function searchMessagesAction(slug: string, input: unknown): Promise<ActionResult<SearchHit[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("search", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return { ok: true, data: await searchMessages(ctx, parsed.data.query, { channelId: parsed.data.channelId }) };
}

// ───────────── Channels ─────────────

const createSchema = z.object({
  name: channelNameSchema,
  kind: z.enum(["PUBLIC", "PRIVATE"]),
  topic: topicSchema.default(""),
  teamId: idSchema.nullable().default(null),
  memberIds: z.array(idSchema).max(200).default([]),
});

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

const updateSchema = z.object({
  channelId: idSchema,
  name: channelNameSchema.optional(),
  topic: topicSchema.optional(),
  isDefault: z.boolean().optional(),
});

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

const archiveSchema = z.object({ channelId: idSchema, archived: z.boolean() });

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

const membersSchema = z.object({ channelId: idSchema, userIds: z.array(idSchema).min(1, "Pick at least one person.").max(100) });

export async function addChannelMembersAction(slug: string, input: unknown): Promise<ActionResult<{ added: number }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = membersSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.addChannelMembers(ctx, parsed.data.channelId, parsed.data.userIds);
}

const removeSchema = z.object({ channelId: idSchema, userId: idSchema });

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

const notifySchema = z.object({ channelId: idSchema, level: notifyLevelSchema });

export async function setNotifyLevelAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = notifySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.setNotifyLevel(ctx, parsed.data.channelId, parsed.data.level);
}

const dmSchema = z.object({ userIds: z.array(idSchema).max(20) });

export async function openDirectMessageAction(slug: string, input: unknown): Promise<ActionResult<{ id: string; href: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = dmSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.openDirectMessage(ctx, parsed.data.userIds);
}

// ───────────── Messages ─────────────

const postSchema = z.object({
  channelId: idSchema,
  body: messageBodySchema,
  parentId: idSchema.nullable().default(null),
  attachmentIds: z.array(idSchema).max(MAX_ATTACHMENTS).default([]),
});

export async function postMessageAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("message", ctx.user.id)) return actionError("You're sending messages very quickly. Wait a moment and try again.");
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.postMessage(ctx, parsed.data);
}

const editSchema = z.object({ messageId: idSchema, body: messageBodySchema });

export async function editMessageAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("message", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.editMessage(ctx, parsed.data);
}

const messageOnlySchema = z.object({ messageId: idSchema });

export async function deleteMessageAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("message", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = messageOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.deleteMessage(ctx, parsed.data.messageId);
}

const reactionSchema = z.object({ messageId: idSchema, emoji: z.string().min(1).max(16) });

export async function toggleReactionAction(slug: string, input: unknown): Promise<ActionResult<{ message: MessageDTO }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return chat.toggleReaction(ctx, parsed.data);
}

const pinSchema = z.object({ messageId: idSchema, pinned: z.boolean() });

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

const typingSchema = z.object({ channelId: idSchema, parentId: idSchema.nullable().default(null) });

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
