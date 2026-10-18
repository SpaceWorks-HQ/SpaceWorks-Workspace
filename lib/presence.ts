import "server-only";

import { prisma } from "@/lib/db";

const PRESENCE_WRITE_INTERVAL_MS = 5 * 60_000;

/** Presence hint for member lists; at most one write per five minutes per user. */
export async function touchLastSeen(userId: string, now = new Date()) {
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - PRESENCE_WRITE_INTERVAL_MS) } }] },
    data: { lastSeenAt: now },
  });
}
