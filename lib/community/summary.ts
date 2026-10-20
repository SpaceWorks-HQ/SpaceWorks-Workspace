import "server-only";

import { prisma } from "@/lib/db";
import { excerpt, richTextToPlain } from "@/lib/community/richText";

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
