import "server-only";

import { prisma } from "@/lib/db";
import { excerpt, richTextToPlain } from "@/lib/community/richText";

/**
 * Read-only community summaries for other areas (the home dashboard, member
 * profiles, the assistant). Each takes the workspace id resolved by the
 * caller's own permission check and returns only what every member may see:
 * published announcements and non-cancelled events.
 */

export async function upcomingCommunityEvents(workspaceId: string, options: { take?: number; now?: Date; userId?: string } = {}) {
  const now = options.now ?? new Date();
  const events = await prisma.communityEvent.findMany({
    where: { workspaceId, cancelledAt: null, startsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    take: Math.min(options.take ?? 4, 50),
    select: {
      id: true,
      title: true,
      kind: true,
      location: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      _count: { select: { attendees: { where: { status: "GOING" } } } },
      // The viewer's own reply (none when no user is given).
      attendees: { where: { userId: options.userId ?? "" }, select: { status: true }, take: 1 },
    },
  });
  return events.map(({ _count, attendees, ...event }) => ({ ...event, going: _count.attendees, myStatus: attendees[0]?.status ?? null }));
}

export async function latestAnnouncements(workspaceId: string, options: { take?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const rows = await prisma.announcement.findMany({
    where: { workspaceId, publishedAt: { not: null, lte: now } },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    take: Math.min(options.take ?? 3, 20),
    select: { id: true, title: true, body: true, pinned: true, publishedAt: true, author: { select: { name: true } } },
  });
  return rows.map(({ body, ...row }) => ({ ...row, publishedAt: row.publishedAt!, preview: excerpt(richTextToPlain(body), 200) }));
}

/** How many shoutouts a member has received (and given) in this workspace. */
export async function shoutoutTotals(workspaceId: string, userId: string) {
  const [received, given] = await Promise.all([
    prisma.shoutout.count({ where: { workspaceId, toId: userId } }),
    prisma.shoutout.count({ where: { workspaceId, fromId: userId } }),
  ]);
  return { received, given };
}

export async function recentShoutouts(workspaceId: string, take = 3) {
  return prisma.shoutout.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 20),
    select: { id: true, message: true, createdAt: true, from: { select: { id: true, name: true } }, to: { select: { id: true, name: true } } },
  });
}
