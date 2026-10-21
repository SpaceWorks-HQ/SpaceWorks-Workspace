import "server-only";

import { channelHref, readableChannelIds, type ChatContext } from "@/lib/chat/access";
import { dmTitle } from "@/lib/chat/dm";
import { messageSelect, toMessageDTOs } from "@/lib/chat/render";
import type { MessageDTO, SearchHit } from "@/lib/chat/types";
import { prisma } from "@/lib/db";
import { Prisma, type ChannelKind } from "@prisma/client";

// ───────────── Search ─────────────

/**
 * Full-text search over messages the member may read (the Message
 * `searchVector`, config `simple`), optionally inside one channel.
 */
export async function searchMessages(ctx: ChatContext, query: string, options: { channelId?: string | null; limit?: number } = {}): Promise<SearchHit[]> {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return [];
  const readable = await readableChannelIds(ctx);
  const ids = options.channelId ? (readable.has(options.channelId) ? [options.channelId] : []) : [...readable];
  if (ids.length === 0) return [];
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 50);
  const found = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Message"
    WHERE "workspaceId" = ${ctx.workspace.id}
      AND "deletedAt" IS NULL
      AND "channelId" IN (${Prisma.join(ids)})
      AND "searchVector" @@ websearch_to_tsquery('simple', ${q})
    ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${q})) DESC, "createdAt" DESC
    LIMIT ${limit}`;
  if (found.length === 0) return [];
  const rows = await prisma.message.findMany({
    where: { id: { in: found.map((f) => f.id) }, workspaceId: ctx.workspace.id },
    select: { ...messageSelect, channel: { select: { id: true, name: true, slug: true, kind: true, members: { where: { channel: { kind: "DIRECT" } }, select: { user: { select: { id: true, name: true } } }, take: 9 } } } },
  });
  const order = new Map(found.map((f, i) => [f.id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const hits: SearchHit[] = [];
  const byChannel = new Map<string, typeof rows>();
  for (const row of rows) byChannel.set(row.channelId, [...(byChannel.get(row.channelId) ?? []), row]);
  const dtos = new Map<string, MessageDTO>();
  for (const [, list] of byChannel) {
    const channel = list[0]!.channel;
    for (const dto of await toMessageDTOs(ctx, { id: channel.id, kind: channel.kind as ChannelKind }, list)) dtos.set(dto.id, dto);
  }
  for (const row of rows) {
    const dto = dtos.get(row.id);
    if (!dto) continue;
    const base = channelHref(ctx.workspace.slug, row.channel);
    const name = row.channel.kind === "DIRECT" ? dmTitle(row.channel.members.map((m) => ({ id: m.user.id, name: m.user.name })), ctx.user.id) : row.channel.name;
    hits.push({
      id: row.id,
      channelId: row.channelId,
      channelName: name,
      channelKind: row.channel.kind,
      href: row.parentId ? `${base}?thread=${row.parentId}&m=${row.id}` : `${base}?m=${row.id}`,
      author: dto.author,
      html: dto.html,
      createdAt: dto.createdAt,
      inThread: Boolean(row.parentId),
    });
  }
  return hits;
}
