import "server-only";

import type { ChannelKind, NotifyLevel, Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import {
  canAddMembers,
  canAdministerChannel,
  canBroadcast,
  canJoinPublic,
  canRemoveMember,
  canSetTopic,
} from "@/lib/chat/policy";
import type { ChannelInfo } from "@/lib/chat/types";

/**
 * Who may see and post in a channel. Everything in chat goes through
 * `resolveChannel`, which looks the channel up inside the caller's workspace
 * (never by a bare id) and answers null when it must stay invisible.
 *
 * - DIRECT and PRIVATE: channel members only (admins included: no peeking).
 * - PUBLIC: every member and up; guests only when added. Channels of a
 *   private team stay hidden from people outside the team unless they were
 *   added to the channel.
 * - Archived channels stay readable but nobody posts.
 */

export type ChatContext = Pick<WorkspaceContext, "user" | "workspace" | "membership">;

export const channelSelect = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  topic: true,
  kind: true,
  isDefault: true,
  archivedAt: true,
  createdById: true,
  dmKey: true,
  lastMessageAt: true,
  teamId: true,
  team: { select: { name: true } },
} satisfies Prisma.ChannelSelect;

export type ChannelRow = Prisma.ChannelGetPayload<{ select: typeof channelSelect }>;

export type ChannelMemberRow = { lastReadAt: Date | null; notify: NotifyLevel; joinedAt: Date } | null;

export type ResolvedChannel = {
  channel: ChannelRow;
  member: ChannelMemberRow;
  canRead: boolean;
  canPost: boolean;
};

export function channelHref(workspaceSlug: string, channel: { id: string; slug: string; kind: ChannelKind }): string {
  return channel.kind === "DIRECT" ? `/w/${workspaceSlug}/dm/${channel.id}` : `/w/${workspaceSlug}/chat/${channel.slug}`;
}

/** Pure access decision (unit-friendly). */
export function decideAccess(input: {
  kind: ChannelKind;
  archived: boolean;
  isMember: boolean;
  role: ChatContext["membership"]["role"];
  teamHidden: boolean;
}): { canRead: boolean; canPost: boolean } {
  let canRead: boolean;
  if (input.kind === "PUBLIC") {
    canRead = input.isMember || (hasRoleAtLeast(input.role, "MEMBER") && !input.teamHidden);
  } else {
    canRead = input.isMember;
  }
  // DMs belong to members; a member demoted to guest keeps read-only history out of reach too.
  if (input.kind === "DIRECT" && !hasRoleAtLeast(input.role, "MEMBER")) canRead = false;
  return { canRead, canPost: canRead && input.isMember && !input.archived };
}

export async function resolveChannel(ctx: ChatContext, where: { id: string } | { slug: string }, client: DbClient = prisma): Promise<ResolvedChannel | null> {
  const key = "id" in where ? where.id : where.slug;
  if (typeof key !== "string" || key.length === 0 || key.length > 100) return null;
  const channel = await client.channel.findFirst({
    where: { workspaceId: ctx.workspace.id, ...("id" in where ? { id: where.id } : { slug: where.slug, kind: { not: "DIRECT" } }) },
    select: channelSelect,
  });
  if (!channel) return null;
  const member = await client.channelMember.findUnique({
    where: { channelId_userId: { channelId: channel.id, userId: ctx.user.id } },
    select: { lastReadAt: true, notify: true, joinedAt: true },
  });
  const hidden = channel.teamId && !member ? (await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role }, client)).includes(channel.teamId) : false;
  const access = decideAccess({ kind: channel.kind, archived: Boolean(channel.archivedAt), isMember: Boolean(member), role: ctx.membership.role, teamHidden: hidden });
  if (!access.canRead) return null;
  return { channel, member, ...access };
}

/** Ids of channels the member may read (for search, link rendering and autocomplete). */
export async function readableChannelIds(ctx: ChatContext, client: DbClient = prisma): Promise<Set<string>> {
  const [memberOf, hidden] = await Promise.all([
    client.channelMember.findMany({ where: { userId: ctx.user.id, channel: { workspaceId: ctx.workspace.id } }, select: { channelId: true, channel: { select: { kind: true } } } }),
    hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role }, client),
  ]);
  const ids = new Set(memberOf.filter((m) => m.channel.kind !== "DIRECT" || hasRoleAtLeast(ctx.membership.role, "MEMBER")).map((m) => m.channelId));
  if (hasRoleAtLeast(ctx.membership.role, "MEMBER")) {
    const publicChannels = await client.channel.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        kind: "PUBLIC",
        ...(hidden.length > 0 ? { OR: [{ teamId: null }, { teamId: { notIn: hidden } }] } : {}),
      },
      select: { id: true },
    });
    for (const channel of publicChannels) ids.add(channel.id);
  }
  return ids;
}

/** Realtime audience: everyone for plain public channels, else the channel's members. */
export async function channelAudience(channel: { id: string; kind: ChannelKind; teamId: string | null }, client: DbClient = prisma): Promise<string[] | undefined> {
  if (channel.kind === "PUBLIC" && !channel.teamId) return undefined;
  const members = await client.channelMember.findMany({ where: { channelId: channel.id }, select: { userId: true } });
  return members.map((m) => m.userId);
}

/** Everything a conversation page needs about its channel, from the viewer's side. */
export async function channelInfo(ctx: ChatContext, resolved: ResolvedChannel): Promise<ChannelInfo> {
  const { channel, member } = resolved;
  const [memberCount, people] = await Promise.all([
    prisma.channelMember.count({ where: { channelId: channel.id } }),
    channel.kind === "DIRECT"
      ? prisma.channelMember.findMany({
          where: { channelId: channel.id },
          select: { user: { select: { id: true, name: true, image: true } } },
          take: 12,
        })
      : Promise.resolve([]),
  ]);
  const isMember = Boolean(member);
  const archived = Boolean(channel.archivedAt);
  const m = ctx.membership;
  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    slug: channel.slug,
    href: channelHref(ctx.workspace.slug, channel),
    topic: channel.topic,
    isDefault: channel.isDefault,
    archived,
    teamId: channel.teamId,
    teamName: channel.team?.name ?? null,
    createdById: channel.createdById,
    memberCount,
    isMember,
    notify: member?.notify ?? "ALL",
    lastReadAt: member?.lastReadAt?.toISOString() ?? member?.joinedAt.toISOString() ?? null,
    people: people.map((p) => ({ id: p.user.id, name: p.user.name ?? "Former member", image: p.user.image })),
    can: {
      post: resolved.canPost,
      join: !isMember && !archived && channel.kind === "PUBLIC" && canJoinPublic(m),
      leave: isMember && channel.kind !== "DIRECT",
      setTopic: !archived && canSetTopic(m, isMember, channel.kind),
      administer: channel.kind !== "DIRECT" && canAdministerChannel(m),
      addMembers: !archived && canAddMembers(m, isMember, channel.kind),
      removeMembers: canRemoveMember(m, ctx.user.id, channel),
      broadcast: canBroadcast(m, channel.kind),
      upload: resolved.canPost && hasRoleAtLeast(m.role, "GUEST"),
    },
  };
}
