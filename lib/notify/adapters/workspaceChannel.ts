import "server-only";

import { prisma } from "@/lib/db";
import type { DestinationAdapter } from "@/lib/notify/adapters/types";
import { renderPlainText } from "@/lib/notify/render";
import { publish } from "@/lib/realtime";

/**
 * WORKSPACE_CHANNEL destinations ({ channelId }): posts a SYSTEM message with
 * origin "notify" into a workspace chat channel (the chat UI renders it as a
 * card) and nudges the channel's realtime stream.
 */
export const workspaceChannelAdapter: DestinationAdapter = {
  kind: "WORKSPACE_CHANNEL",
  label: "Workspace channel",
  configured: true,
  async send({ message, target, isTest }) {
    if (target.type !== "destination") return { ok: false, retryable: false, error: "Workspace channels are not a personal channel." };
    const config = target.destination.config;
    const channelId = config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>).channelId : null;
    if (typeof channelId !== "string") return { ok: false, retryable: false, error: "Pick a channel for this destination." };

    const channel = await prisma.channel.findFirst({
      where: { id: channelId, workspaceId: message.workspace.id, archivedAt: null, kind: { not: "DIRECT" } },
      select: { id: true, kind: true, members: { select: { userId: true } } },
    });
    if (!channel) return { ok: false, retryable: false, error: "The channel was archived or removed." };

    const now = new Date();
    const body = `${isTest ? "[Test] " : ""}${renderPlainText(message)}`.slice(0, 4000);
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.message.create({
        data: { workspaceId: message.workspace.id, channelId: channel.id, authorKind: "SYSTEM", body, origin: "notify", createdAt: now },
        select: { id: true },
      });
      await tx.channel.update({ where: { id: channel.id }, data: { lastMessageAt: now } });
      return row;
    });
    await publish(message.workspace.id, `channel:${channel.id}`, {
      type: "message.created",
      data: { channelId: channel.id, messageId: created.id },
      ...(channel.kind === "PUBLIC" ? {} : { audience: channel.members.map((member) => member.userId) }),
    });
    return { ok: true, providerMessageId: created.id };
  },
};
