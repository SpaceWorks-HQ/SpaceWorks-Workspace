import "server-only";

import { channelHref, type ChatContext } from "@/lib/chat/access";
import { toPlainText } from "@/lib/chat/text";
import { prisma, type Tx } from "@/lib/db";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { type ChannelKind } from "@prisma/client";

// ───────────── Search index ─────────────

/** Public-channel messages go into global search; private channels and DMs never do. */
export async function indexMessage(
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

export async function indexChannel(client: Tx | typeof prisma, ctx: ChatContext, channel: { id: string; kind: ChannelKind; name: string; slug: string; topic: string | null; teamId: string | null; archivedAt: Date | null }) {
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
