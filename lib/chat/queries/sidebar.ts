import "server-only";

import { channelHref, type ChatContext } from "@/lib/chat/access";
import { dmTitle } from "@/lib/chat/dm";
import type { ChatPerson, SidebarData, SidebarItem } from "@/lib/chat/types";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";

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
