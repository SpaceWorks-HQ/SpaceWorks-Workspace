import "server-only";

import { type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import { afterCursor, beforeCursor, takePage, type Cursor } from "@/lib/chat/cursor";
import { messageSelect, toMessageDTOs } from "@/lib/chat/render";
import type { MessageDTO, MessagePage } from "@/lib/chat/types";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

/** Top-level messages that are visible in the channel timeline. */
function timelineWhere(channelId: string): Prisma.MessageWhereInput {
  // A deleted message stays as a placeholder only while its thread has replies.
  return { channelId, parentId: null, OR: [{ deletedAt: null }, { replyCount: { gt: 0 } }] };
}

// ───────────── Timeline ─────────────

/**
 * One page of the channel timeline, oldest first.
 * - no cursor: the latest page
 * - `before`: older than the cursor
 * - `after`: newer than the cursor
 */
export async function listMessages(ctx: ChatContext, resolved: ResolvedChannel, options: { before?: Cursor | null; after?: Cursor | null; limit: number }): Promise<MessagePage> {
  const base = timelineWhere(resolved.channel.id);
  const channel = { id: resolved.channel.id, kind: resolved.channel.kind };
  if (options.after) {
    const rows = await prisma.message.findMany({
      where: { AND: [base, afterCursor(options.after)] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: options.limit + 1,
      select: messageSelect,
    });
    const page = takePage(rows, options.limit);
    return { messages: await toMessageDTOs(ctx, channel, page.items), hasOlder: true, hasNewer: page.hasMore };
  }
  const rows = await prisma.message.findMany({
    where: options.before ? { AND: [base, beforeCursor(options.before)] } : base,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    select: messageSelect,
  });
  const page = takePage(rows, options.limit);
  return { messages: await toMessageDTOs(ctx, channel, page.items.reverse()), hasOlder: page.hasMore, hasNewer: false };
}

/** A page centred on one message (deep links and search results). */
export async function listAround(ctx: ChatContext, resolved: ResolvedChannel, messageId: string, limit: number): Promise<MessagePage | null> {
  const anchor = await prisma.message.findFirst({ where: { id: messageId, channelId: resolved.channel.id, parentId: null }, select: { id: true, createdAt: true } });
  if (!anchor) return null;
  const half = Math.max(5, Math.floor(limit / 2));
  const base = timelineWhere(resolved.channel.id);
  const [older, newer] = await Promise.all([
    prisma.message.findMany({ where: { AND: [base, beforeCursor(anchor)] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: half + 1, select: messageSelect }),
    prisma.message.findMany({ where: { AND: [base, { OR: [{ id: anchor.id }, afterCursor(anchor)] }] }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: half + 1, select: messageSelect }),
  ]);
  const olderPage = takePage(older, half);
  const newerPage = takePage(newer, half);
  const rows = [...olderPage.items.reverse(), ...newerPage.items];
  return { messages: await toMessageDTOs(ctx, { id: resolved.channel.id, kind: resolved.channel.kind }, rows), hasOlder: olderPage.hasMore, hasNewer: newerPage.hasMore };
}

/** Specific messages by id (realtime refetch), timeline or thread. */
export async function messagesByIds(ctx: ChatContext, resolved: ResolvedChannel, ids: string[]): Promise<MessageDTO[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.message.findMany({
    where: { id: { in: ids.slice(0, 50) }, channelId: resolved.channel.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: messageSelect,
  });
  return toMessageDTOs(ctx, { id: resolved.channel.id, kind: resolved.channel.kind }, rows);
}

/** A thread: the root plus its replies (oldest first, paged from the start). */
export async function listThread(ctx: ChatContext, resolved: ResolvedChannel, parentId: string, options: { after?: Cursor | null; limit: number }): Promise<{ root: MessageDTO; replies: MessageDTO[]; hasMore: boolean } | null> {
  const root = await prisma.message.findFirst({ where: { id: parentId, channelId: resolved.channel.id, parentId: null }, select: messageSelect });
  if (!root || (root.deletedAt && root.replyCount === 0)) return null;
  const rows = await prisma.message.findMany({
    where: { parentId: root.id, deletedAt: null, ...(options.after ? afterCursor(options.after) : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: options.limit + 1,
    select: messageSelect,
  });
  const page = takePage(rows, options.limit);
  const [rootDto, ...replies] = await toMessageDTOs(ctx, { id: resolved.channel.id, kind: resolved.channel.kind }, [root, ...page.items]);
  return { root: rootDto!, replies, hasMore: page.hasMore };
}

export async function listPinned(ctx: ChatContext, resolved: ResolvedChannel): Promise<MessageDTO[]> {
  const rows = await prisma.message.findMany({
    where: { channelId: resolved.channel.id, pinnedAt: { not: null }, deletedAt: null },
    orderBy: { pinnedAt: "desc" },
    take: 50,
    select: messageSelect,
  });
  return toMessageDTOs(ctx, { id: resolved.channel.id, kind: resolved.channel.kind }, rows);
}
