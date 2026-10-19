import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  EVENT_CATALOG,
  isEventType,
  type NotifyCategory,
} from "@/lib/notify/events";
export type NotificationFilter = {
  tab?: string;
  category?: string;
  before?: Date;
};
export function notificationWhere(
  workspaceId: string,
  userId: string,
  filter: NotificationFilter = {},
): Prisma.NotificationWhereInput {
  const kinds = Object.entries(EVENT_CATALOG)
    .filter(([, spec]) => spec.category === filter.category)
    .map(([type]) => type);
  return {
    workspaceId,
    userId,
    archivedAt: null,
    ...(filter.tab === "unread" ? { readAt: null } : {}),
    ...(filter.tab === "mentions"
      ? { kind: "mention" }
      : filter.category
        ? { kind: { in: kinds } }
        : {}),
    ...(filter.tab === "mentions" &&
    filter.category &&
    filter.category !== "mentions"
      ? { id: { in: [] } }
      : {}),
    ...(filter.before ? { createdAt: { lt: filter.before } } : {}),
  };
}
export async function notificationCentre(
  workspaceId: string,
  userId: string,
  filter: NotificationFilter = {},
) {
  const [items, unread, mentions] = await Promise.all([
    prisma.notification.findMany({
      where: notificationWhere(workspaceId, userId, filter),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: { event: { select: { payload: true } } },
    }),
    prisma.notification.count({
      where: notificationWhere(workspaceId, userId, { tab: "unread" }),
    }),
    prisma.notification.count({
      where: {
        ...notificationWhere(workspaceId, userId, { tab: "mentions" }),
        readAt: null,
      },
    }),
  ]);
  return { items, unread, mentions };
}
export function notificationCategory(kind: string): NotifyCategory | null {
  return isEventType(kind) ? EVENT_CATALOG[kind].category : null;
}
