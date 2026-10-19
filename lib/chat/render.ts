import "server-only";

import type { ChannelKind, MessagingProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RASTER_IMAGE_TYPES } from "@/lib/storage/policy";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { channelHref, readableChannelIds, type ChatContext } from "@/lib/chat/access";
import { encodeCursor } from "@/lib/chat/cursor";
import { canDeleteMessage, canEditMessage, canPinMessage } from "@/lib/chat/policy";
import { summarizeReactions } from "@/lib/chat/reactions";
import { renderMessageHtml } from "@/lib/chat/sanitize";
import { decodeForEditing, extractChannelLinks, extractTaskRefs, extractUserMentions, hasBroadcastMention } from "@/lib/chat/text";
import type { ChatPerson, MessageDTO, MessageOrigin } from "@/lib/chat/types";

/** Columns every message read needs to build a DTO. */
export const messageSelect = {
  id: true,
  channelId: true,
  parentId: true,
  authorId: true,
  authorKind: true,
  body: true,
  origin: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  pinnedAt: true,
  replyCount: true,
  lastReplyAt: true,
  author: { select: { id: true, name: true, image: true } },
  pinnedBy: { select: { name: true } },
  reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: "asc" } },
  attachments: { select: { file: { select: { id: true, filename: true, contentType: true, size: true, deletedAt: true } } } },
} satisfies Prisma.MessageSelect;

export type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

const PROVIDER_LABELS: Record<MessagingProvider, string> = {
  SLACK: "Slack",
  DISCORD: "Discord",
  MATTERMOST: "Mattermost",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
};

function person(user: { id: string; name: string | null; image: string | null } | null): ChatPerson | null {
  return user ? { id: user.id, name: user.name?.trim() || "Former member", image: user.image } : null;
}

/** Names of workspace members by id (people who left show as "Former member"). */
export async function memberNames(workspaceId: string, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)].slice(0, 500) }, memberships: { some: { workspaceId } } },
    select: { id: true, name: true },
  });
  return Object.fromEntries(users.map((u) => [u.id, u.name?.trim() || "Former member"]));
}

/** Build the viewer-specific DTOs for a list of messages from one channel. */
export async function toMessageDTOs(ctx: ChatContext, channel: { id: string; kind: ChannelKind }, rows: MessageRow[]): Promise<MessageDTO[]> {
  if (rows.length === 0) return [];
  const viewerId = ctx.user.id;
  const live = rows.filter((row) => !row.deletedAt);

  const userIds = new Set<string>();
  const channelIds = new Set<string>();
  const taskRefs = new Map<string, { key: string; number: number }>();
  for (const row of live) {
    for (const id of extractUserMentions(row.body)) userIds.add(id);
    for (const id of extractChannelLinks(row.body)) channelIds.add(id);
    for (const ref of extractTaskRefs(row.body)) taskRefs.set(`${ref.key}-${ref.number}`, ref);
    for (const reaction of row.reactions) userIds.add(reaction.userId);
  }

  const roots = rows.filter((row) => row.replyCount > 0 && !row.parentId).map((row) => row.id);
  const bridgeIds = [...new Set(rows.map((row) => row.origin).filter((o): o is string => Boolean(o?.startsWith("bridge:"))).map((o) => o.slice("bridge:".length)))];

  const [replyAuthors, linkedChannels, readable, tasks, bridges] = await Promise.all([
    roots.length
      ? prisma.message.findMany({
          where: { parentId: { in: roots }, deletedAt: null, authorId: { not: null } },
          distinct: ["parentId", "authorId"],
          orderBy: { createdAt: "desc" },
          select: { parentId: true, author: { select: { id: true, name: true, image: true } } },
          take: 500,
        })
      : Promise.resolve([]),
    channelIds.size
      ? prisma.channel.findMany({ where: { id: { in: [...channelIds] }, workspaceId: ctx.workspace.id }, select: { id: true, name: true, slug: true, kind: true } })
      : Promise.resolve([]),
    channelIds.size ? readableChannelIds(ctx) : Promise.resolve(new Set<string>()),
    taskRefs.size ? findTaskLinks(ctx, [...taskRefs.values()]) : Promise.resolve({} as Record<string, string>),
    bridgeIds.length
      ? prisma.bridgedChannel.findMany({ where: { id: { in: bridgeIds }, workspaceId: ctx.workspace.id }, select: { id: true, connection: { select: { provider: true } } } })
      : Promise.resolve([]),
  ]);
  const names = await memberNames(ctx.workspace.id, [...userIds]);

  const channels: Record<string, { name: string; href: string }> = {};
  const channelSlugs: Record<string, string> = {};
  for (const linked of linkedChannels) {
    if (!readable.has(linked.id) || linked.kind === "DIRECT") continue;
    channels[linked.id] = { name: linked.name, href: channelHref(ctx.workspace.slug, linked) };
    channelSlugs[linked.id] = linked.slug;
  }
  const bridgeLabels = new Map(bridges.map((b) => [b.id, PROVIDER_LABELS[b.connection.provider]]));
  const repliers = new Map<string, ChatPerson[]>();
  for (const reply of replyAuthors) {
    if (!reply.parentId || !reply.author) continue;
    const list = repliers.get(reply.parentId) ?? [];
    if (list.length < 3) list.push(person(reply.author)!);
    repliers.set(reply.parentId, list);
  }

  return rows.map((row): MessageDTO => {
    const deleted = Boolean(row.deletedAt);
    const origin: MessageOrigin = row.origin === "notify" ? { kind: "notify" } : row.origin?.startsWith("bridge:") ? { kind: "bridge", label: bridgeLabels.get(row.origin.slice(7)) ?? "another app" } : null;
    const editable = canEditMessage(row, viewerId);
    const mentioned = !deleted && (extractUserMentions(row.body).includes(viewerId) || (hasBroadcastMention(row.body) && row.authorId !== viewerId));
    return {
      id: row.id,
      channelId: row.channelId,
      parentId: row.parentId,
      author: person(row.author),
      authorKind: row.authorKind,
      origin,
      html: deleted ? "" : renderMessageHtml(row.body, { users: names, channels, tasks, viewerId }),
      source: editable ? decodeForEditing(row.body, names, channelSlugs) : null,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      deleted,
      pinned: !deleted && Boolean(row.pinnedAt),
      pinnedByName: row.pinnedAt ? row.pinnedBy?.name ?? null : null,
      replyCount: row.replyCount,
      lastReplyAt: row.lastReplyAt?.toISOString() ?? null,
      replyPeople: repliers.get(row.id) ?? [],
      reactions: deleted ? [] : summarizeReactions(row.reactions, viewerId, names),
      attachments: deleted
        ? []
        : row.attachments
            .filter((a) => !a.file.deletedAt)
            .map((a) => ({
              id: a.file.id,
              filename: a.file.filename,
              contentType: a.file.contentType,
              size: a.file.size,
              url: `/api/files/${encodeURIComponent(a.file.id)}`,
              downloadUrl: `/api/files/${encodeURIComponent(a.file.id)}?download=1`,
              isImage: RASTER_IMAGE_TYPES.has(a.file.contentType),
            })),
      mentionsMe: mentioned,
      canEdit: editable,
      canDelete: canDeleteMessage(ctx.membership, row, viewerId, channel.kind),
      canPin: canPinMessage(ctx.membership, row, viewerId, channel.kind),
      cursor: encodeCursor(row),
    };
  });
}

/** "KEY-12" → task URL for tasks that exist and that the viewer may see. */
async function findTaskLinks(ctx: ChatContext, refs: Array<{ key: string; number: number }>): Promise<Record<string, string>> {
  const hidden = await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role });
  const tasks = await prisma.task.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      number: { in: [...new Set(refs.map((r) => r.number))] },
      project: { key: { in: [...new Set(refs.map((r) => r.key))] }, ...(hidden.length ? { OR: [{ teamId: null }, { teamId: { notIn: hidden } }] } : {}) },
    },
    select: { number: true, project: { select: { key: true } } },
    take: 100,
  });
  const out: Record<string, string> = {};
  for (const task of tasks) {
    if (!task.project) continue;
    out[`${task.project.key}-${task.number}`] = `/w/${ctx.workspace.slug}/projects/${encodeURIComponent(task.project.key)}/tasks/${task.number}`;
  }
  return out;
}
