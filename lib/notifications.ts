import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import { publishToUser } from "@/lib/realtime";

export type NotificationInput = {
  userId: string;
  workspaceId?: string | null;
  /** e.g. "task.assigned", "mention", "shoutout", "invite.accepted". */
  kind: string;
  title: string;
  body?: string | null;
  /** App-relative URL to open, e.g. /w/kochi/projects/BOT/tasks/12. */
  url?: string | null;
};

function safeUrl(url: string | null | undefined) {
  return url && url.startsWith("/") && !url.startsWith("//") ? url.slice(0, 500) : null;
}

/**
 * Create notifications (skipping `excludeUserId`, usually the actor) and
 * push a realtime "notification.created" event to each recipient. Pass a
 * transaction client to commit with the change; realtime is sent afterwards
 * by the caller via `announceNotifications` in that case.
 */
export async function createNotifications(inputs: NotificationInput[], options: { client?: DbClient; excludeUserId?: string | null } = {}) {
  const rows = inputs
    .filter((input) => input.userId !== options.excludeUserId)
    .map((input) => ({
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      kind: input.kind.slice(0, 64),
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 1000) ?? null,
      url: safeUrl(input.url),
    }));
  if (rows.length === 0) return 0;
  const result = await (options.client ?? prisma).notification.createMany({ data: rows });
  if (!options.client) await announceNotifications(rows);
  return result.count;
}

export async function createNotification(input: NotificationInput, options: { client?: DbClient; excludeUserId?: string | null } = {}) {
  return createNotifications([input], options);
}

/** Realtime nudge for recipients (best effort, ids only). */
export async function announceNotifications(rows: Array<{ userId: string; workspaceId: string | null; kind: string }>) {
  await Promise.all(
    rows
      .filter((row) => row.workspaceId)
      .map((row) => publishToUser(row.workspaceId!, row.userId, { type: "notification.created", data: { kind: row.kind } })),
  );
}

export async function listNotifications(userId: string, options: { workspaceId?: string; unreadOnly?: boolean; take?: number } = {}) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.take ?? 30, 1), 100),
    select: { id: true, kind: true, title: true, body: true, url: true, readAt: true, createdAt: true, workspaceId: true },
  });
}

export async function countUnreadNotifications(userId: string, workspaceId?: string) {
  return prisma.notification.count({ where: { userId, readAt: null, ...(workspaceId ? { workspaceId } : {}) } });
}

/** Mark specific notifications (always scoped to the owner) or all of them as read. */
export async function markNotificationsRead(userId: string, ids?: string[]) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids.slice(0, 200) } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}
