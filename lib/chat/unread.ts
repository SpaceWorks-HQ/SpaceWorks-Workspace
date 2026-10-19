import type { ChannelKind, NotifyLevel } from "@prisma/client";

/**
 * Unread and notification rules (pure, client-safe).
 *
 * A channel member's `lastReadAt` marks how far they have read. Messages from
 * other people after it (top-level only: thread replies notify separately)
 * are unread. Mentions of the member are counted on their own so the sidebar
 * can show a badge.
 */

/** "3", "42", "99+". */
export function formatBadge(count: number): string {
  return count > 99 ? "99+" : String(Math.max(0, Math.floor(count)));
}

export type SidebarState = { bold: boolean; badge: number | null; muted: boolean };

/**
 * How a sidebar row looks: DMs badge every unread message; channels badge
 * mentions only and turn bold when anything is unread, unless muted.
 */
export function sidebarState(input: { kind: ChannelKind; unread: number; mentions: number; notify: NotifyLevel }): SidebarState {
  const muted = input.notify === "NONE";
  if (input.kind === "DIRECT") {
    return { bold: input.unread > 0, badge: input.unread > 0 && !muted ? input.unread : null, muted };
  }
  return { bold: input.unread > 0 && !muted, badge: input.mentions > 0 ? input.mentions : null, muted };
}

/** Is a message newer than the member's read marker (and not their own)? */
export function isUnread(message: { createdAt: string | Date; authorId: string | null }, lastReadAt: string | Date | null, viewerId: string): boolean {
  if (message.authorId === viewerId) return false;
  if (!lastReadAt) return true;
  return new Date(message.createdAt).getTime() > new Date(lastReadAt).getTime();
}

/**
 * Where the "New messages" divider goes: the first message from someone else
 * after `lastReadAt`. Null when nothing is unread (or nothing was read yet and
 * the whole page is new, which needs no divider).
 */
export function firstUnreadId(
  messages: Array<{ id: string; createdAt: string | Date; authorId: string | null }>,
  lastReadAt: string | Date | null,
  viewerId: string,
): string | null {
  if (!lastReadAt) return null;
  const first = messages.find((message) => isUnread(message, lastReadAt, viewerId));
  return first?.id ?? null;
}

/** The later of two read markers (read markers never move backwards). */
export function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export type NotifyReason = "mention" | "broadcast" | "thread" | "dm";

/**
 * Does a member's channel notification level allow this notification?
 * ALL: everything. MENTIONS: direct mentions and DMs. NONE (muted): nothing.
 */
export function allowsNotification(level: NotifyLevel, reason: NotifyReason): boolean {
  if (level === "NONE") return false;
  if (level === "ALL") return true;
  return reason === "mention" || reason === "dm";
}

export type RecipientPlan = { mention: string[]; dm: string[]; thread: string[] };

/**
 * Who hears about a new message, by event. Each person gets at most one
 * notification per message: mention beats DM beats thread reply.
 *
 * - `members`: channel members with their level (the author is skipped).
 * - `mentioned`: users named with `<@id>` who can read the channel.
 * - `broadcast`: the message used `<!channel>` / `<!here>`.
 * - `threadParticipants`: root author and earlier repliers (for replies).
 */
export function planRecipients(input: {
  authorId: string;
  kind: ChannelKind;
  members: Array<{ userId: string; notify: NotifyLevel }>;
  mentioned: string[];
  broadcast: boolean;
  isReply: boolean;
  threadParticipants: string[];
  /** People who can read the channel without being members (public channels). */
  readersOutsideChannel?: ReadonlySet<string>;
}): RecipientPlan {
  const level = new Map(input.members.map((m) => [m.userId, m.notify] as const));
  const done = new Set<string>([input.authorId]);
  const plan: RecipientPlan = { mention: [], dm: [], thread: [] };

  for (const userId of input.mentioned) {
    if (done.has(userId)) continue;
    const memberLevel = level.get(userId) ?? (input.readersOutsideChannel?.has(userId) ? "MENTIONS" : undefined);
    if (memberLevel && allowsNotification(memberLevel, "mention")) {
      plan.mention.push(userId);
      done.add(userId);
    }
  }
  if (input.broadcast && input.kind !== "DIRECT") {
    for (const member of input.members) {
      if (done.has(member.userId) || !allowsNotification(member.notify, "broadcast")) continue;
      plan.mention.push(member.userId);
      done.add(member.userId);
    }
  }
  if (input.kind === "DIRECT") {
    for (const member of input.members) {
      if (done.has(member.userId) || !allowsNotification(member.notify, "dm")) continue;
      plan.dm.push(member.userId);
      done.add(member.userId);
    }
  }
  if (input.isReply) {
    for (const userId of input.threadParticipants) {
      if (done.has(userId)) continue;
      const memberLevel = level.get(userId);
      if (!memberLevel || !allowsNotification(memberLevel, input.kind === "DIRECT" ? "dm" : "thread")) continue;
      plan.thread.push(userId);
      done.add(userId);
    }
  }
  return plan;
}
