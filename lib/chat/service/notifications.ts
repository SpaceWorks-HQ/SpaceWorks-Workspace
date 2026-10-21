import "server-only";

import { channelHref, type ChatContext, type ResolvedChannel } from "@/lib/chat/access";
import { memberNames } from "@/lib/chat/render";
import { preview, toPlainText } from "@/lib/chat/text";
import { planRecipients } from "@/lib/chat/unread";
import { type Tx } from "@/lib/db";
import { dispatch, type DispatchResult } from "@/lib/notify";
import { hiddenTeamIds } from "@/lib/teamAccess";

/** Mentions, DMs and thread replies through dispatch (inside the post transaction). */
export async function notifyForMessage(
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
