import "server-only";

import { readableChannelIds, resolveChannel, type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import { canBroadcast } from "@/lib/chat/policy";
import { messageSelect, toMessageDTOs } from "@/lib/chat/render";
import { MAX_MESSAGE_LENGTH, extractUserMentions, normalizeBody, sanitizeTokens } from "@/lib/chat/text";
import type { MessageDTO } from "@/lib/chat/types";
import { prisma } from "@/lib/db";

import { activeMembers } from "./context";

// ───────────── Messages ─────────────

/** Token rules for a body this member is about to store in this channel. */
export async function prepareBody(ctx: ChatContext, channel: ResolvedChannel["channel"], raw: string): Promise<{ body: string } | { error: string }> {
  const normalized = normalizeBody(raw);
  if (normalized.length > MAX_MESSAGE_LENGTH) return { error: `Keep messages under ${MAX_MESSAGE_LENGTH} characters. Split it into a few messages.` };
  const mentioned = extractUserMentions(normalized);
  const [members, readable, slugRows] = await Promise.all([
    activeMembers(ctx, mentioned),
    normalized.includes("#") || normalized.includes("<#") ? readableChannelIds(ctx) : Promise.resolve(new Set<string>()),
    normalized.includes("#")
      ? prisma.channel.findMany({ where: { workspaceId: ctx.workspace.id, kind: { not: "DIRECT" }, archivedAt: null }, select: { id: true, slug: true }, take: 1000 })
      : Promise.resolve([]),
  ]);
  const slugs = new Map(slugRows.filter((row) => readable.has(row.id)).map((row) => [row.slug, row.id]));
  const body = sanitizeTokens(normalized, {
    memberIds: new Set(members.map((m) => m.userId)),
    allowBroadcast: canBroadcast(ctx.membership, channel.kind),
    channelIds: readable,
    channelSlugs: slugs,
  });
  return { body };
}

/** Load a message in this workspace together with its channel access. */
export async function resolveMessage(ctx: ChatContext, messageId: string) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, workspaceId: ctx.workspace.id },
    select: { id: true, channelId: true, parentId: true, authorId: true, authorKind: true, deletedAt: true, origin: true, body: true, pinnedAt: true },
  });
  if (!message) return null;
  const resolved = await resolveChannel(ctx, { id: message.channelId });
  if (!resolved) return null;
  return { message, resolved };
}

export async function oneDTO(ctx: ChatContext, resolved: ResolvedChannel, id: string): Promise<MessageDTO> {
  const row = await prisma.message.findUniqueOrThrow({ where: { id }, select: messageSelect });
  const [dto] = await toMessageDTOs(ctx, { id: resolved.channel.id, kind: resolved.channel.kind }, [row]);
  return dto!;
}
