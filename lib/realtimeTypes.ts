/**
 * Wire format of realtime events (shared by server and browser code).
 * Events are notifications that something changed, not data: carry ids and
 * kinds only, never message bodies or private content. Clients refetch
 * through authorised server code when they receive one.
 */
export type RealtimeEvent = {
  /** e.g. "message.created", "task.updated", "notification.created". */
  type: string;
  /** Logical stream inside the workspace: "workspace", "channel:<id>", "project:<id>", "task:<id>", "user:<id>", "doc:<id>". */
  channel: string;
  data?: Record<string, string | number | boolean | null>;
  /** When set, only these user ids receive the event (private channels, DMs, per-user notifications). */
  audience?: string[];
  actorId?: string | null;
  /** ISO timestamp set by the publisher. */
  at: string;
};

/** Should `userId` receive `event`? Pure so it can be unit-tested. */
export function isEventVisibleTo(event: RealtimeEvent, userId: string): boolean {
  if (event.channel.startsWith("user:") && event.channel !== `user:${userId}`) return false;
  if (event.audience && !event.audience.includes(userId)) return false;
  return true;
}
