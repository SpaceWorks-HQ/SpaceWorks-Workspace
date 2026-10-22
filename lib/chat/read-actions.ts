import "server-only";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { context, NOT_AVAILABLE } from "./action-context";
import { resolveChannel } from "./access";
import { byIdsSchema, channelOnlySchema, pageSchema, searchSchema, threadSchema } from "./action-validation";
import { clampLimit, decodeCursor } from "./cursor";
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
} from "./queries";
import type { BrowseChannel, MessageDTO, MessagePage, SearchHit, SidebarData } from "./types";

export async function loadSidebarAction(slug: string): Promise<ActionResult<SidebarData>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  return { ok: true, data: await getSidebar(ctx) };
}

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

export async function loadMessagesByIdsAction(slug: string, input: unknown): Promise<ActionResult<MessageDTO[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const parsed = byIdsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const resolved = await resolveChannel(ctx, { id: parsed.data.channelId });
  if (!resolved) return actionError(NOT_AVAILABLE);
  return { ok: true, data: await messagesByIds(ctx, resolved, parsed.data.ids) };
}

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

export async function searchMessagesAction(slug: string, input: unknown): Promise<ActionResult<SearchHit[]>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("search", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return { ok: true, data: await searchMessages(ctx, parsed.data.query, { channelId: parsed.data.channelId }) };
}
