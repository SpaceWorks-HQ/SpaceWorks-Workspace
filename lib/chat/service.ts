import "server-only";

import { createHash } from "crypto";
import { Prisma, type ChannelKind, type NotifyLevel } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { actionError, NOT_ALLOWED, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { dispatch, type DispatchResult } from "@/lib/notify";
import { publish, publishToUser } from "@/lib/realtime";
import { hasRoleAtLeast } from "@/lib/roles";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { uploadWorkspaceFile } from "@/lib/storage";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { channelAudience, channelHref, readableChannelIds, resolveChannel, type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import { dmKey, dmParticipants, MAX_DM_PARTICIPANTS } from "@/lib/chat/dm";
import {
  canAddMembers,
  canAdministerChannel,
  canBroadcast,
  canCreateChannel,
  canDeleteMessage,
  canEditMessage,
  canJoinPublic,
  canPinMessage,
  canRemoveMember,
  canSetTopic,
  canStartDirectMessage,
  MAX_ATTACHMENTS,
} from "@/lib/chat/policy";
import { isAllowedReaction } from "@/lib/chat/reactions";
import { messageSelect, memberNames, toMessageDTOs } from "@/lib/chat/render";
import { MAX_MESSAGE_LENGTH, extractUserMentions, hasBroadcastMention, normalizeBody, preview, sanitizeTokens, toPlainText } from "@/lib/chat/text";
import type { AttachmentDTO, MessageDTO } from "@/lib/chat/types";
import { planRecipients } from "@/lib/chat/unread";
import { RASTER_IMAGE_TYPES } from "@/lib/storage/policy";

/**
 * Write side of chat. Server actions (app/actions/chat.ts) authenticate,
 * rate-limit and parse input, then call these functions with the resolved
 * workspace context. Each function re-checks channel access itself.
 */

const NOT_FOUND = "That conversation isn't available. It may have been archived or you may have left it.";
const MESSAGE_GONE = "That message isn't available any more.";

// ───────────── Realtime helpers ─────────────

async function publishChannel(ctx: ChatContext, channel: { id: string; kind: ChannelKind; teamId: string | null }, type: string, data: Record<string, string | number | boolean | null>) {
  const audience = await channelAudience(channel);
  await publish(ctx.workspace.id, `channel:${channel.id}`, { type, data: { channelId: channel.id, ...data }, actorId: ctx.user.id, ...(audience ? { audience } : {}) });
}

async function nudgeUsers(ctx: ChatContext, userIds: string[], type: string, data: Record<string, string | number | boolean | null>) {
  await Promise.all([...new Set(userIds)].map((userId) => publishToUser(ctx.workspace.id, userId, { type, data, actorId: ctx.user.id })));
}

// ───────────── Search index ─────────────

/** Public-channel messages go into global search; private channels and DMs never do. */
async function indexMessage(
  client: Tx,
  ctx: ChatContext,
  channel: { id: string; kind: ChannelKind; name: string; slug: string; teamId: string | null },
  message: { id: string; parentId: string | null; body: string },
  authorName: string,
) {
  if (channel.kind !== "PUBLIC") return;
  const base = channelHref(ctx.workspace.slug, channel);
  await indexSearchDocument(
    {
      workspaceId: ctx.workspace.id,
      entityType: "message",
      entityId: message.id,
      title: `#${channel.name} · ${authorName}`,
      body: toPlainText(message.body),
      url: message.parentId ? `${base}?thread=${message.parentId}&m=${message.id}` : `${base}?m=${message.id}`,
      teamId: channel.teamId,
      channelId: channel.id,
      ownerId: ctx.user.id,
    },
    client,
  );
}

async function indexChannel(client: Tx | typeof prisma, ctx: ChatContext, channel: { id: string; kind: ChannelKind; name: string; slug: string; topic: string | null; teamId: string | null; archivedAt: Date | null }) {
  if (channel.kind !== "PUBLIC" || channel.archivedAt) {
    await removeSearchDocument("channel", channel.id, client);
    return;
  }
  await indexSearchDocument(
    {
      workspaceId: ctx.workspace.id,
      entityType: "channel",
      entityId: channel.id,
      title: `#${channel.name}`,
      body: channel.topic ?? "",
      url: channelHref(ctx.workspace.slug, channel),
      teamId: channel.teamId,
      channelId: channel.id,
    },
    client,
  );
}

// ───────────── Channels ─────────────

function uniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Active members of this workspace among `ids` (optionally at least `minRole`). */
async function activeMembers(ctx: ChatContext, ids: string[], minRole: "GUEST" | "MEMBER" = "GUEST") {
  if (ids.length === 0) return [];
  const rows = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspace.id, userId: { in: [...new Set(ids)].slice(0, 200) }, status: "ACTIVE", user: { disabledAt: null } },
    select: { userId: true, role: true },
  });
  return rows.filter((row) => hasRoleAtLeast(row.role, minRole));
}

export async function createChannel(
  ctx: ChatContext,
  input: { name: string; kind: "PUBLIC" | "PRIVATE"; topic: string; teamId: string | null; memberIds: string[] },
): Promise<ActionResult<{ href: string; id: string }>> {
  if (!canCreateChannel(ctx.membership, input.kind)) {
    return actionError(input.kind === "PUBLIC" ? "Only admins can create public channels. Create a private channel instead." : NOT_ALLOWED);
  }
  if (input.teamId) {
    const team = await prisma.team.findFirst({ where: { id: input.teamId, workspaceId: ctx.workspace.id, archivedAt: null }, select: { id: true } });
    const hidden = await hiddenTeamIds(ctx.workspace.id, { userId: ctx.user.id, role: ctx.membership.role });
    if (!team || hidden.includes(team.id)) return actionError("Pick a team you belong to.");
  }
  const invited = input.kind === "PRIVATE" ? (await activeMembers(ctx, input.memberIds)).map((m) => m.userId).filter((id) => id !== ctx.user.id) : [];
  try {
    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: {
          workspaceId: ctx.workspace.id,
          name: input.name,
          slug: input.name,
          kind: input.kind,
          topic: input.topic || null,
          teamId: input.teamId,
          createdById: ctx.user.id,
          members: { create: [{ userId: ctx.user.id }, ...invited.map((userId) => ({ userId }))] },
        },
      });
      await indexChannel(tx, ctx, created);
      await recordAuditEvent({ action: "chat.channel_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: created.id, metadata: { kind: created.kind, invited: invited.length }, client: tx });
      if (created.kind === "PUBLIC") {
        await recordActivity({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, verb: "created", entityType: "channel", entityId: created.id, summary: `Started #${created.name}`, teamId: created.teamId }, tx);
      }
      return created;
    });
    await nudgeUsers(ctx, invited, "chat.membership", { channelId: channel.id, added: true });
    return { ok: true, data: { id: channel.id, href: channelHref(ctx.workspace.slug, channel) } };
  } catch (error) {
    if (uniqueViolation(error)) return actionError("A channel with that name already exists. Pick another name.", { name: ["A channel with that name already exists."] });
    throw error;
  }
}

export async function joinChannel(ctx: ChatContext, channelId: string): Promise<ActionResult<{ href: string }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (resolved.member) return { ok: true, data: { href: channelHref(ctx.workspace.slug, channel) } };
  if (channel.kind !== "PUBLIC" || channel.archivedAt || !canJoinPublic(ctx.membership)) return actionError(NOT_ALLOWED);
  await prisma.channelMember.createMany({ data: [{ channelId: channel.id, userId: ctx.user.id, lastReadAt: new Date() }], skipDuplicates: true });
  await publishChannel(ctx, channel, "channel.members", { userId: ctx.user.id, joined: true });
  await nudgeUsers(ctx, [ctx.user.id], "chat.membership", { channelId: channel.id, added: true });
  return { ok: true, data: { href: channelHref(ctx.workspace.slug, channel) } };
}

export async function leaveChannel(ctx: ChatContext, channelId: string): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.member) return actionError(NOT_FOUND);
  if (resolved.channel.kind === "DIRECT") return actionError("You can't leave a direct message. Mute it instead.");
  await prisma.channelMember.deleteMany({ where: { channelId: resolved.channel.id, userId: ctx.user.id } });
  await publishChannel(ctx, resolved.channel, "channel.members", { userId: ctx.user.id, joined: false });
  await nudgeUsers(ctx, [ctx.user.id], "chat.membership", { channelId: resolved.channel.id, added: false });
  return { ok: true };
}

export async function updateChannel(
  ctx: ChatContext,
  channelId: string,
  input: { name?: string; topic?: string; isDefault?: boolean },
): Promise<ActionResult<{ href: string }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (channel.kind === "DIRECT") return actionError(NOT_ALLOWED);
  if (channel.archivedAt) return actionError("This channel is archived. Unarchive it first.");
  const wantsAdmin = input.name !== undefined || input.isDefault !== undefined;
  if (wantsAdmin && !canAdministerChannel(ctx.membership)) return actionError(NOT_ALLOWED);
  if (input.topic !== undefined && !canSetTopic(ctx.membership, Boolean(resolved.member), channel.kind)) return actionError(NOT_ALLOWED);
  if (input.isDefault && channel.kind !== "PUBLIC") return actionError("Only public channels can be default channels.");
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.channel.update({
        where: { id: channel.id },
        data: {
          ...(input.name !== undefined ? { name: input.name, slug: input.name } : {}),
          ...(input.topic !== undefined ? { topic: input.topic || null } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
        },
      });
      await indexChannel(tx, ctx, row);
      await recordAuditEvent({
        action: "chat.channel_updated",
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        targetType: "Channel",
        targetId: row.id,
        metadata: { renamed: input.name !== undefined && input.name !== channel.name, topic: input.topic !== undefined, isDefault: input.isDefault ?? null },
        client: tx,
      });
      return row;
    });
    await publishChannel(ctx, updated, "channel.updated", {});
    return { ok: true, data: { href: channelHref(ctx.workspace.slug, updated) } };
  } catch (error) {
    if (uniqueViolation(error)) return actionError("A channel with that name already exists. Pick another name.", { name: ["A channel with that name already exists."] });
    throw error;
  }
}

export async function setChannelArchived(ctx: ChatContext, channelId: string, archived: boolean): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (channel.kind === "DIRECT" || !canAdministerChannel(ctx.membership)) return actionError(NOT_ALLOWED);
  if (Boolean(channel.archivedAt) === archived) return { ok: true };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.channel.update({ where: { id: channel.id }, data: { archivedAt: archived ? new Date() : null, ...(archived ? { isDefault: false } : {}) } });
    await indexChannel(tx, ctx, row);
    await recordAuditEvent({ action: archived ? "chat.channel_archived" : "chat.channel_unarchived", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: row.id, client: tx });
    if (row.kind === "PUBLIC") {
      await recordActivity({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, verb: archived ? "archived" : "unarchived", entityType: "channel", entityId: row.id, summary: `${archived ? "Archived" : "Unarchived"} #${row.name}`, teamId: row.teamId }, tx);
    }
    return row;
  });
  await publishChannel(ctx, updated, "channel.updated", { archived });
  return { ok: true };
}

export async function addChannelMembers(ctx: ChatContext, channelId: string, userIds: string[]): Promise<ActionResult<{ added: number }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (channel.archivedAt || !canAddMembers(ctx.membership, Boolean(resolved.member), channel.kind)) return actionError(NOT_ALLOWED);
  const targets = (await activeMembers(ctx, userIds)).map((m) => m.userId);
  if (targets.length === 0) return actionError("Pick at least one active member.");
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.channelMember.createMany({ data: targets.map((userId) => ({ channelId: channel.id, userId })), skipDuplicates: true });
    await recordAuditEvent({ action: "chat.member_added", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: channel.id, metadata: { count: created.count }, client: tx });
    return created;
  });
  await publishChannel(ctx, channel, "channel.members", { joined: true });
  await nudgeUsers(ctx, targets, "chat.membership", { channelId: channel.id, added: true });
  return { ok: true, data: { added: result.count } };
}

export async function removeChannelMember(ctx: ChatContext, channelId: string, userId: string): Promise<ActionResult> {
  if (userId === ctx.user.id) return leaveChannel(ctx, channelId);
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (!canRemoveMember(ctx.membership, ctx.user.id, channel)) return actionError(NOT_ALLOWED);
  const removed = await prisma.$transaction(async (tx) => {
    const row = await tx.channelMember.deleteMany({ where: { channelId: channel.id, userId } });
    if (row.count > 0) {
      await recordAuditEvent({ action: "chat.member_removed", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Channel", targetId: channel.id, metadata: { userId }, client: tx });
    }
    return row.count;
  });
  if (removed === 0) return actionError("That person isn't in this channel.");
  await publishChannel(ctx, channel, "channel.members", { joined: false });
  await nudgeUsers(ctx, [userId], "chat.membership", { channelId: channel.id, added: false });
  return { ok: true };
}

export async function setNotifyLevel(ctx: ChatContext, channelId: string, level: NotifyLevel): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.member) return actionError("Join the channel to change its notifications.");
  await prisma.channelMember.update({ where: { channelId_userId: { channelId: resolved.channel.id, userId: ctx.user.id } }, data: { notify: level } });
  await nudgeUsers(ctx, [ctx.user.id], "chat.read", { channelId: resolved.channel.id });
  return { ok: true };
}

/** Find or create the DM for this group of people (yourself included). */
export async function openDirectMessage(ctx: ChatContext, otherIds: string[]): Promise<ActionResult<{ id: string; href: string }>> {
  if (!canStartDirectMessage(ctx.membership)) return actionError(NOT_ALLOWED);
  const wanted = [...new Set(otherIds.filter((id) => id !== ctx.user.id))];
  if (wanted.length > MAX_DM_PARTICIPANTS - 1) return actionError(`A direct message can include up to ${MAX_DM_PARTICIPANTS - 1} other people.`);
  const others = (await activeMembers(ctx, wanted, "MEMBER")).map((m) => m.userId);
  if (others.length !== wanted.length) return actionError("Some of those people can't receive direct messages. Pick active members.");
  const participants = dmParticipants(ctx.user.id, others);
  const key = dmKey(ctx.workspace.id, participants);
  const existing = await prisma.channel.findUnique({ where: { dmKey: key }, select: { id: true, workspaceId: true } });
  if (existing && existing.workspaceId === ctx.workspace.id) return { ok: true, data: { id: existing.id, href: `/w/${ctx.workspace.slug}/dm/${existing.id}` } };
  try {
    const created = await prisma.channel.create({
      data: {
        workspaceId: ctx.workspace.id,
        kind: "DIRECT",
        name: "Direct message",
        slug: `dm-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
        dmKey: key,
        createdById: ctx.user.id,
        members: { create: participants.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return { ok: true, data: { id: created.id, href: `/w/${ctx.workspace.slug}/dm/${created.id}` } };
  } catch (error) {
    if (!uniqueViolation(error)) throw error;
    const raced = await prisma.channel.findUnique({ where: { dmKey: key }, select: { id: true } });
    if (!raced) throw error;
    return { ok: true, data: { id: raced.id, href: `/w/${ctx.workspace.slug}/dm/${raced.id}` } };
  }
}

// ───────────── Messages ─────────────

/** Token rules for a body this member is about to store in this channel. */
async function prepareBody(ctx: ChatContext, channel: ResolvedChannel["channel"], raw: string): Promise<{ body: string } | { error: string }> {
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
async function resolveMessage(ctx: ChatContext, messageId: string) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, workspaceId: ctx.workspace.id },
    select: { id: true, channelId: true, parentId: true, authorId: true, authorKind: true, deletedAt: true, origin: true, body: true, pinnedAt: true },
  });
  if (!message) return null;
  const resolved = await resolveChannel(ctx, { id: message.channelId });
  if (!resolved) return null;
  return { message, resolved };
}

async function oneDTO(ctx: ChatContext, resolved: ResolvedChannel, id: string): Promise<MessageDTO> {
  const row = await prisma.message.findUniqueOrThrow({ where: { id }, select: messageSelect });
  const [dto] = await toMessageDTOs(ctx, { id: resolved.channel.id, kind: resolved.channel.kind }, [row]);
  return dto!;
}

export async function postMessage(
  ctx: ChatContext,
  input: { channelId: string; body: string; parentId: string | null; attachmentIds: string[] },
): Promise<ActionResult<{ message: MessageDTO }>> {
  const resolved = await resolveChannel(ctx, { id: input.channelId });
  if (!resolved) return actionError(NOT_FOUND);
  const { channel } = resolved;
  if (!resolved.canPost) {
    return actionError(channel.archivedAt ? "This channel is archived, so it's read-only." : "Join the channel to post here.");
  }
  const prepared = await prepareBody(ctx, channel, input.body);
  if ("error" in prepared) return actionError(prepared.error);
  const attachmentIds = [...new Set(input.attachmentIds)];
  if (!prepared.body && attachmentIds.length === 0) return actionError("Write a message or attach a file.");
  if (attachmentIds.length > MAX_ATTACHMENTS) return actionError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);

  let parent: { id: string; authorId: string | null } | null = null;
  if (input.parentId) {
    parent = await prisma.message.findFirst({ where: { id: input.parentId, channelId: channel.id, parentId: null, deletedAt: null }, select: { id: true, authorId: true } });
    if (!parent) return actionError("That thread isn't available any more.");
  }
  if (attachmentIds.length > 0) {
    const files = await prisma.fileObject.count({
      where: {
        id: { in: attachmentIds },
        workspaceId: ctx.workspace.id,
        uploadedById: ctx.user.id,
        deletedAt: null,
        messageAttachments: { none: {} },
        createdAt: { gt: new Date(Date.now() - 24 * 3600_000) },
      },
    });
    if (files !== attachmentIds.length) return actionError("Some attachments are no longer available. Upload them again.");
  }

  const now = new Date();
  const mentioned = extractUserMentions(prepared.body);
  const broadcast = hasBroadcastMention(prepared.body);
  const actorName = ctx.user.name?.trim() || "Someone";

  const { id, dispatches } = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        workspaceId: ctx.workspace.id,
        channelId: channel.id,
        authorId: ctx.user.id,
        body: prepared.body,
        parentId: parent?.id ?? null,
        createdAt: now,
        attachments: attachmentIds.length ? { create: attachmentIds.map((fileId) => ({ fileId })) } : undefined,
      },
      select: { id: true, parentId: true, body: true },
    });
    if (parent) {
      await tx.message.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 }, lastReplyAt: now } });
    } else {
      await tx.channel.update({ where: { id: channel.id }, data: { lastMessageAt: now } });
    }
    await tx.channelMember.updateMany({ where: { channelId: channel.id, userId: ctx.user.id, OR: [{ lastReadAt: null }, { lastReadAt: { lt: now } }] }, data: { lastReadAt: now } });
    await indexMessage(tx, ctx, channel, message, actorName);
    const results = await notifyForMessage(tx, ctx, resolved, { id: message.id, body: message.body, parentId: message.parentId, parentAuthorId: parent?.authorId ?? null, mentioned, broadcast });
    return { id: message.id, dispatches: results };
  });

  for (const result of dispatches) await result.afterCommit();
  await publishChannel(ctx, channel, "message.created", { messageId: id, parentId: parent?.id ?? null });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, id) } };
}

/** Mentions, DMs and thread replies through dispatch (inside the post transaction). */
async function notifyForMessage(
  tx: Tx,
  ctx: ChatContext,
  resolved: ResolvedChannel,
  message: { id: string; body: string; parentId: string | null; parentAuthorId: string | null; mentioned: string[]; broadcast: boolean },
): Promise<DispatchResult[]> {
  const { channel } = resolved;
  const members = await tx.channelMember.findMany({ where: { channelId: channel.id }, select: { userId: true, notify: true } });
  const memberIds = new Set(members.map((m) => m.userId));

  // Public channels: mentioned members who can read it without having joined.
  let readersOutsideChannel = new Set<string>();
  const outside = message.mentioned.filter((id) => !memberIds.has(id));
  if (channel.kind === "PUBLIC" && outside.length > 0) {
    const candidates = await tx.membership.findMany({ where: { workspaceId: ctx.workspace.id, userId: { in: outside }, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] } }, select: { userId: true, role: true } });
    const visible: string[] = [];
    for (const candidate of candidates) {
      if (!channel.teamId) visible.push(candidate.userId);
      else if (!(await hiddenTeamIds(ctx.workspace.id, candidate, tx)).includes(channel.teamId)) visible.push(candidate.userId);
    }
    readersOutsideChannel = new Set(visible);
  }

  let threadParticipants: string[] = [];
  if (message.parentId) {
    const repliers = await tx.message.findMany({ where: { parentId: message.parentId, deletedAt: null, authorId: { not: null } }, distinct: ["authorId"], select: { authorId: true }, take: 100 });
    threadParticipants = [message.parentAuthorId, ...repliers.map((r) => r.authorId)].filter((id): id is string => Boolean(id));
  }

  const plan = planRecipients({
    authorId: ctx.user.id,
    kind: channel.kind,
    members,
    mentioned: message.mentioned,
    broadcast: message.broadcast,
    isReply: Boolean(message.parentId),
    threadParticipants,
    readersOutsideChannel,
  });
  if (plan.mention.length + plan.dm.length + plan.thread.length === 0) return [];

  const names = await memberNames(ctx.workspace.id, message.mentioned);
  const text = preview(toPlainText(message.body, names), 140) || "Shared a file";
  const actor = ctx.user.name?.trim() || "Someone";
  const base = channelHref(ctx.workspace.slug, channel);
  const url = message.parentId ? `${base}?thread=${message.parentId}&m=${message.id}` : `${base}?m=${message.id}`;
  const where = channel.kind === "DIRECT" ? (members.length > 2 ? " in a group message" : "") : ` in #${channel.name}`;
  const scope = { channelId: channel.id };
  const results: DispatchResult[] = [];

  if (plan.mention.length) {
    results.push(
      await dispatch(
        ctx.workspace.id,
        {
          type: "mention",
          title: `${actor} mentioned you${where}`,
          body: text,
          url,
          actorId: ctx.user.id,
          recipients: plan.mention,
          resource: message.parentId ? { type: "thread", id: message.parentId } : { type: "message", id: message.id },
          scope,
          data: { sourceType: "message", sourceId: message.id, channelId: channel.id },
        },
        { tx },
      ),
    );
  }
  if (plan.dm.length) {
    results.push(
      await dispatch(
        ctx.workspace.id,
        {
          type: "message.dm",
          title: members.length > 2 ? `${actor} sent a message${where}` : `${actor} sent you a message`,
          body: text,
          url,
          actorId: ctx.user.id,
          recipients: plan.dm,
          resource: { type: "channel", id: channel.id },
          scope,
          dedupeKey: `dm:${channel.id}`,
          dedupeWindowSec: 90,
          data: { channelId: channel.id, messageId: message.id },
        },
        { tx },
      ),
    );
  }
  if (plan.thread.length && message.parentId) {
    results.push(
      await dispatch(
        ctx.workspace.id,
        {
          type: "thread.reply",
          title: `${actor} replied to a thread${where}`,
          body: text,
          url,
          actorId: ctx.user.id,
          recipients: plan.thread,
          resource: { type: "thread", id: message.parentId },
          scope,
          dedupeKey: `thread:${message.parentId}`,
          dedupeWindowSec: 90,
          data: { channelId: channel.id, messageId: message.id, parentId: message.parentId },
        },
        { tx },
      ),
    );
  }
  return results;
}

export async function editMessage(ctx: ChatContext, input: { messageId: string; body: string }): Promise<ActionResult<{ message: MessageDTO }>> {
  const found = await resolveMessage(ctx, input.messageId);
  if (!found) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!canEditMessage(message, ctx.user.id)) return actionError("You can only edit your own messages.");
  if (resolved.channel.archivedAt) return actionError("This channel is archived, so it's read-only.");
  const prepared = await prepareBody(ctx, resolved.channel, input.body);
  if ("error" in prepared) return actionError(prepared.error);
  if (!prepared.body) {
    const attachments = await prisma.messageAttachment.count({ where: { messageId: message.id } });
    if (attachments === 0) return actionError("A message can't be empty. Delete it instead.");
  }
  if (prepared.body === message.body) return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.message.update({ where: { id: message.id }, data: { body: prepared.body, editedAt: new Date() }, select: { id: true, parentId: true, body: true } });
    await indexMessage(tx, ctx, resolved.channel, updated, ctx.user.name?.trim() || "Someone");
  });
  await publishChannel(ctx, resolved.channel, "message.updated", { messageId: message.id, parentId: message.parentId });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
}

export async function deleteMessage(ctx: ChatContext, messageId: string): Promise<ActionResult> {
  const found = await resolveMessage(ctx, messageId);
  if (!found) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!canDeleteMessage(ctx.membership, message, ctx.user.id, resolved.channel.kind)) return actionError(NOT_ALLOWED);
  const moderated = message.authorId !== ctx.user.id;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.message.updateMany({ where: { id: message.id, deletedAt: null }, data: { deletedAt: new Date(), pinnedAt: null, pinnedById: null } });
    if (updated.count === 0) return;
    if (message.parentId) {
      await tx.message.updateMany({ where: { id: message.parentId, replyCount: { gt: 0 } }, data: { replyCount: { decrement: 1 } } });
    }
    await tx.messageReaction.deleteMany({ where: { messageId: message.id } });
    await removeSearchDocument("message", message.id, tx);
    await recordAuditEvent({
      action: "chat.message_deleted",
      workspaceId: ctx.workspace.id,
      actorId: ctx.user.id,
      targetType: "Message",
      targetId: message.id,
      metadata: { channelId: resolved.channel.id, moderated },
      client: tx,
    });
  });
  await publishChannel(ctx, resolved.channel, "message.deleted", { messageId: message.id, parentId: message.parentId });
  return { ok: true };
}

export async function toggleReaction(ctx: ChatContext, input: { messageId: string; emoji: string }): Promise<ActionResult<{ message: MessageDTO }>> {
  if (!isAllowedReaction(input.emoji)) return actionError("Pick one of the reactions on the list.");
  const found = await resolveMessage(ctx, input.messageId);
  if (!found || found.message.deletedAt) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!resolved.canPost) return actionError("Join the channel to react.");
  const existing = await prisma.messageReaction.findUnique({ where: { messageId_userId_emoji: { messageId: message.id, userId: ctx.user.id, emoji: input.emoji } }, select: { id: true } });
  if (existing) {
    await prisma.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.messageReaction.createMany({ data: [{ messageId: message.id, userId: ctx.user.id, emoji: input.emoji }], skipDuplicates: true });
  }
  await publishChannel(ctx, resolved.channel, "message.updated", { messageId: message.id, parentId: message.parentId });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
}

export async function setPinned(ctx: ChatContext, input: { messageId: string; pinned: boolean }): Promise<ActionResult<{ message: MessageDTO }>> {
  const found = await resolveMessage(ctx, input.messageId);
  if (!found || found.message.deletedAt) return actionError(MESSAGE_GONE);
  const { message, resolved } = found;
  if (!resolved.canPost || !canPinMessage(ctx.membership, message, ctx.user.id, resolved.channel.kind)) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async (tx) => {
    await tx.message.update({ where: { id: message.id }, data: input.pinned ? { pinnedAt: new Date(), pinnedById: ctx.user.id } : { pinnedAt: null, pinnedById: null } });
    await recordAuditEvent({ action: input.pinned ? "chat.message_pinned" : "chat.message_unpinned", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "Message", targetId: message.id, metadata: { channelId: resolved.channel.id }, client: tx });
  });
  await publishChannel(ctx, resolved.channel, "message.updated", { messageId: message.id, parentId: message.parentId, pinned: input.pinned });
  return { ok: true, data: { message: await oneDTO(ctx, resolved, message.id) } };
}

/** Move the read marker to now (never backwards) and tell the member's other tabs. */
export async function markRead(ctx: ChatContext, channelId: string): Promise<ActionResult> {
  const now = new Date();
  const updated = await prisma.channelMember.updateMany({
    where: { channelId, userId: ctx.user.id, channel: { workspaceId: ctx.workspace.id }, OR: [{ lastReadAt: null }, { lastReadAt: { lt: now } }] },
    data: { lastReadAt: now },
  });
  if (updated.count > 0) await nudgeUsers(ctx, [ctx.user.id], "chat.read", { channelId });
  return { ok: true };
}

export async function sendTyping(ctx: ChatContext, channelId: string, parentId: string | null): Promise<ActionResult> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.canPost) return { ok: true };
  await publishChannel(ctx, resolved.channel, "typing", { userId: ctx.user.id, name: ctx.user.name?.trim() || "Someone", parentId });
  return { ok: true };
}

export async function uploadAttachment(ctx: ChatContext, channelId: string, file: File): Promise<ActionResult<{ attachment: AttachmentDTO }>> {
  const resolved = await resolveChannel(ctx, { id: channelId });
  if (!resolved?.canPost) return actionError("Join the channel to share files.");
  const result = await uploadWorkspaceFile({ workspaceId: ctx.workspace.id, uploadedById: ctx.user.id, file, folder: "/chat" });
  if (!result.ok) return actionError(result.error);
  const stored = result.file;
  return {
    ok: true,
    data: {
      attachment: {
        id: stored.id,
        filename: stored.filename,
        contentType: stored.contentType,
        size: stored.size,
        url: `/api/files/${encodeURIComponent(stored.id)}`,
        downloadUrl: `/api/files/${encodeURIComponent(stored.id)}?download=1`,
        isImage: RASTER_IMAGE_TYPES.has(stored.contentType),
      },
    },
  };
}
