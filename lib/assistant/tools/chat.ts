import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { hasRoleAtLeast } from "@/lib/roles";
import { channelWhere, clip, findChannel, userNames } from "@/lib/assistant/tools/access";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, plural, ToolError } from "@/lib/assistant/tools/types";

const channelRef = z.string().trim().min(1).max(80).describe('Channel slug ("general" or "#general") or id.');

export const listChannels = defineTool({
  name: "sw_list_channels",
  title: "Channels",
  description: "List the chat channels the caller can read (never direct messages).",
  input: z.object({ limit: z.number().int().min(1).max(100).default(50), cursor: z.string().trim().max(64).optional() }),
  write: false,
  scope: "read:chat",
  minRole: "GUEST",
  async run(ctx, input) {
    const rows = await prisma.channel.findMany({
      where: await channelWhere(ctx.principal),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: { id: true, name: true, slug: true, topic: true, kind: true, lastMessageAt: true },
    });
    const page = rows.slice(0, input.limit);
    return {
      summary: `Looked up ${plural(page.length, "channel")}`,
      data: {
        channels: page.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          topic: c.topic,
          private: c.kind === "PRIVATE",
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
          url: `/w/${ctx.principal.workspace.slug}/chat/${c.slug}`,
        })),
        nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      },
    };
  },
});

export const readChannelMessages = defineTool({
  name: "sw_read_channel_messages",
  title: "Channel messages",
  description: "Read recent top-level messages in a channel, newest first. Use `before` (an ISO time) to page back.",
  input: z.object({
    channel: channelRef,
    limit: z.number().int().min(1).max(50).default(20),
    before: z.string().trim().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "Use an ISO date-time.").optional(),
  }),
  write: false,
  scope: "read:chat",
  minRole: "GUEST",
  async run(ctx, input) {
    const channel = await findChannel(ctx.principal, input.channel);
    if (!channel) throw new ToolError(`No channel ${input.channel} that you can read.`, "not_found");
    const rows = await prisma.message.findMany({
      where: { channelId: channel.id, workspaceId: ctx.principal.workspace.id, deletedAt: null, parentId: null, ...(input.before ? { createdAt: { lt: new Date(input.before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: { id: true, body: true, authorId: true, authorKind: true, createdAt: true, replyCount: true, pinnedAt: true },
    });
    const names = await userNames(rows.map((r) => r.authorId));
    return {
      summary: `Read ${plural(rows.length, "message")} in #${channel.slug}`,
      data: {
        channel: { name: channel.name, slug: channel.slug, topic: channel.topic },
        messages: rows.map((m) => ({
          id: m.id,
          author: m.authorKind === "ASSISTANT" ? "Space Works Assistant" : m.authorKind === "SYSTEM" ? "Space Works" : (m.authorId && names.get(m.authorId)) || "Former member",
          at: m.createdAt.toISOString(),
          text: clip(m.body, 1500),
          replies: m.replyCount,
          pinned: Boolean(m.pinnedAt),
        })),
        oldestAt: rows.at(-1)?.createdAt.toISOString() ?? null,
      },
    };
  },
});

export const sendChannelMessage = defineTool({
  name: "sw_send_channel_message",
  title: "Post to channel",
  description: "Post a message in a channel as the person you are helping. The person sees the exact text and confirms before it is posted.",
  input: z.object({ channel: channelRef, text: z.string().trim().min(1).max(4000) }),
  write: true,
  scope: "write:chat",
  minRole: "MEMBER",
  async run(ctx, input) {
    const { principal } = ctx;
    const channel = await findChannel(principal, input.channel);
    if (!channel) throw new ToolError(`No channel ${input.channel} that you can post in.`, "not_found");
    if (channel.kind !== "PUBLIC" || !hasRoleAtLeast(principal.role, "MEMBER")) {
      const member = await prisma.channelMember.findUnique({ where: { channelId_userId: { channelId: channel.id, userId: principal.userId } }, select: { userId: true } });
      if (!member) throw new ToolError(`Join #${channel.slug} before posting there.`, "forbidden");
    }
    const now = ctx.now;
    const message = await prisma.$transaction(async (tx) => {
      const row = await tx.message.create({
        data: { workspaceId: principal.workspace.id, channelId: channel.id, authorId: principal.userId, authorKind: "USER", body: input.text, createdAt: now },
        select: { id: true },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { lastMessageAt: now } });
      await auditToolWrite(ctx, { action: "assistant.message_sent", targetType: "Message", targetId: row.id, metadata: { channelId: channel.id } }, tx);
      return row;
    });
    const audience = channel.kind === "PUBLIC" ? null : (await prisma.channelMember.findMany({ where: { channelId: channel.id }, select: { userId: true } })).map((m) => m.userId);
    await publish(principal.workspace.id, `channel:${channel.id}`, {
      type: "message.created",
      data: { channelId: channel.id, messageId: message.id },
      actorId: principal.userId,
      ...(audience ? { audience } : {}),
    });
    return {
      summary: `Posted in #${channel.slug}`,
      data: { messageId: message.id, channel: channel.slug, url: `/w/${principal.workspace.slug}/chat/${channel.slug}` },
    };
  },
});

export const CHAT_TOOLS = [listChannels, readChannelMessages, sendChannelMessage];
