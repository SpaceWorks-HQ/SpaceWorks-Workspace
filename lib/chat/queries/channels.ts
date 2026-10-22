import "server-only";

import type { ChannelMemberDTO } from "@/lib/chat/queries";


import { channelHref, readableChannelIds, type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import type { BrowseChannel, ChannelOption, ChatPerson } from "@/lib/chat/types";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { Prisma } from "@prisma/client";

// ───────────── Members ─────────────



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
