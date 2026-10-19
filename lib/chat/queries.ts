import "server-only";

import { Prisma, type ChannelKind, type WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { channelHref, readableChannelIds, type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import { afterCursor, beforeCursor, takePage, type Cursor } from "@/lib/chat/cursor";
import { dmTitle } from "@/lib/chat/dm";
import { messageSelect, toMessageDTOs } from "@/lib/chat/render";
import type { BrowseChannel, ChannelOption, ChatPerson, MessageDTO, MessagePage, SearchHit, SidebarData, SidebarItem } from "@/lib/chat/types";

/**
 * Read side of chat. Every function takes an already-resolved workspace
 * context (and channel where relevant) and filters by workspace.
 */

/** Top-level messages that are visible in the channel timeline. */
function timelineWhere(channelId: string): Prisma.MessageWhereInput {
  // A deleted message stays as a placeholder only while its thread has replies.
  return { channelId, parentId: null, OR: [{ deletedAt: null }, { replyCount: { gt: 0 } }] };
}

// ───────────── Sidebar ─────────────

type CountRow = { channelId: string; unread: number; mentions: number };

/** Unread and mention counts per channel the member belongs to (one query). */
async function unreadCounts(ctx: ChatContext): Promise<Map<string, CountRow>> {
  const mentionPattern = `%<@${ctx.user.id}>%`;
  const rows = await prisma.$queryRaw<CountRow[]>`
    SELECT m."channelId" AS "channelId",
           COUNT(*)::int AS "unread",
           COUNT(*) FILTER (WHERE c."kind" = 'DIRECT' OR m."body" LIKE ${mentionPattern} OR m."body" LIKE '%<!channel>%' OR m."body" LIKE '%<!here>%')::int AS "mentions"
    FROM "ChannelMember" cm
    JOIN "Channel" c ON c."id" = cm."channelId"
    JOIN "Message" m ON m."channelId" = cm."channelId"
    WHERE cm."userId" = ${ctx.user.id}
      AND c."workspaceId" = ${ctx.workspace.id}
      AND c."archivedAt" IS NULL
      AND m."parentId" IS NULL
      AND m."deletedAt" IS NULL
      AND (m."authorId" IS NULL OR m."authorId" <> ${ctx.user.id})
      AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
    GROUP BY m."channelId"`;
  return new Map(rows.map((row) => [row.channelId, row]));
}

export async function getSidebar(ctx: ChatContext): Promise<SidebarData> {
  const isMemberRole = hasRoleAtLeast(ctx.membership.role, "MEMBER");
  const [memberships, counts] = await Promise.all([
    prisma.channelMember.findMany({
      where: {
        userId: ctx.user.id,
        channel: {
          workspaceId: ctx.workspace.id,
          archivedAt: null,
          ...(isMemberRole ? {} : { kind: { not: "DIRECT" } }),
          // An empty DM someone else opened stays out of the list until its first message.
          OR: [{ kind: { not: "DIRECT" } }, { lastMessageAt: { not: null } }, { createdById: ctx.user.id }],
        },
      },
      select: {
        notify: true,
        channel: {
          select: {
            id: true,
            kind: true,
            name: true,
            slug: true,
            topic: true,
            isDefault: true,
            lastMessageAt: true,
            team: { select: { name: true } },
            members: { where: { channel: { kind: "DIRECT" } }, select: { user: { select: { id: true, name: true, image: true } } }, take: 9 },
          },
        },
      },
      take: 500,
    }),
    unreadCounts(ctx),
  ]);

  const items = memberships.map(({ channel, notify }): SidebarItem => {
    const count = counts.get(channel.id);
    const people: ChatPerson[] = channel.members.map((m) => ({ id: m.user.id, name: m.user.name?.trim() || "Former member", image: m.user.image }));
    const others = people.filter((p) => p.id !== ctx.user.id);
    return {
      id: channel.id,
      kind: channel.kind,
      name: channel.kind === "DIRECT" ? dmTitle(people, ctx.user.id) : channel.name,
      slug: channel.slug,
      href: channelHref(ctx.workspace.slug, channel),
      topic: channel.topic,
      isDefault: channel.isDefault,
      teamName: channel.team?.name ?? null,
      notify,
      unread: count?.unread ?? 0,
      mentions: count?.mentions ?? 0,
      lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
      ...(channel.kind === "DIRECT" ? { people: others.length ? others : people } : {}),
    };
  });

  return {
    channels: items.filter((i) => i.kind !== "DIRECT").sort((a, b) => a.name.localeCompare(b.name)),
    dms: items
      .filter((i) => i.kind === "DIRECT")
      .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.name.localeCompare(b.name))
      .slice(0, 50),
  };
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

// ───────────── Members ─────────────

export type ChannelMemberDTO = Omit<ChatPerson, "role"> & { role: WorkspaceRole | "FORMER"; joinedAt: string; isCreator: boolean };

export async function listChannelMembers(resolved: ResolvedChannel): Promise<ChannelMemberDTO[]> {
  const rows = await prisma.channelMember.findMany({
    where: { channelId: resolved.channel.id },
    orderBy: { joinedAt: "asc" },
    take: 500,
    select: { joinedAt: true, user: { select: { id: true, name: true, image: true, memberships: { where: { workspaceId: resolved.channel.workspaceId }, select: { role: true, status: true } } } } },
  });
  return rows.map((row) => ({
    id: row.user.id,
    name: row.user.name?.trim() || "Former member",
    image: row.user.image,
    role: row.user.memberships[0]?.status === "ACTIVE" ? row.user.memberships[0].role : "FORMER",
    joinedAt: row.joinedAt.toISOString(),
    isCreator: resolved.channel.createdById === row.user.id,
  }));
}

/** Active workspace members for mention autocomplete and pickers. */
export async function listWorkspacePeople(ctx: ChatContext): Promise<Array<ChatPerson & { role: string }>> {
  const rows = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspace.id, status: "ACTIVE", user: { disabledAt: null } },
    select: { role: true, user: { select: { id: true, name: true, image: true, email: true } } },
    orderBy: { user: { name: "asc" } },
    take: 1000,
  });
  return rows.map((row) => ({ id: row.user.id, name: row.user.name?.trim() || row.user.email.split("@")[0]!, image: row.user.image, role: row.role }));
}

/** Channels for `#` autocomplete: everything the member may read, except DMs. */
export async function listChannelOptions(ctx: ChatContext): Promise<ChannelOption[]> {
  const ids = await readableChannelIds(ctx);
  const rows = await prisma.channel.findMany({
    where: { id: { in: [...ids] }, workspaceId: ctx.workspace.id, kind: { not: "DIRECT" }, archivedAt: null },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows;
}

// ───────────── Browse ─────────────

export async function browseChannels(ctx: ChatContext, options: { includeArchived?: boolean } = {}): Promise<BrowseChannel[]> {
  const hidden = await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role });
  const isMemberRole = hasRoleAtLeast(ctx.membership.role, "MEMBER");
  const visibility: Prisma.ChannelWhereInput[] = [{ kind: { in: ["PUBLIC", "PRIVATE"] }, members: { some: { userId: ctx.user.id } } }];
  if (isMemberRole) visibility.push({ kind: "PUBLIC", ...(hidden.length ? { OR: [{ teamId: null }, { teamId: { notIn: hidden } }] } : {}) });
  const rows = await prisma.channel.findMany({
    where: { workspaceId: ctx.workspace.id, ...(options.includeArchived ? {} : { archivedAt: null }), OR: visibility },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      topic: true,
      isDefault: true,
      archivedAt: true,
      lastMessageAt: true,
      team: { select: { name: true } },
      _count: { select: { members: true } },
      members: { where: { userId: ctx.user.id }, select: { userId: true } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    href: channelHref(ctx.workspace.slug, row),
    kind: row.kind,
    topic: row.topic,
    memberCount: row._count.members,
    isMember: row.members.length > 0,
    isDefault: row.isDefault,
    archived: Boolean(row.archivedAt),
    teamName: row.team?.name ?? null,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
  }));
}

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

// ───────────── Layout ─────────────

/** Teams a new channel may belong to (private teams only for their members and admins). */
export async function listTeamOptions(ctx: ChatContext): Promise<Array<{ id: string; name: string }>> {
  const hidden = await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role });
  return prisma.team.findMany({
    where: { workspaceId: ctx.workspace.id, archivedAt: null, ...(hidden.length ? { id: { notIn: hidden } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
  });
}

/** Everything the chat frame needs once per navigation. */
export async function getChatShellData(ctx: ChatContext) {
  const [sidebar, people, channels, teams] = await Promise.all([getSidebar(ctx), listWorkspacePeople(ctx), listChannelOptions(ctx), listTeamOptions(ctx)]);
  return {
    sidebar,
    people,
    channels,
    teams,
    viewer: { id: ctx.user.id, name: ctx.user.name?.trim() || ctx.user.email, role: ctx.membership.role },
  };
}

