import "server-only";
import { prisma } from "@/lib/db";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import type { SearchActor } from "@/lib/search/query";
export async function listLinks(
  actor: SearchActor,
  tag?: string,
  query?: string,
) {
  const hidden = await hiddenTeamIds(actor.workspaceId, actor);
  return prisma.linkItem.findMany({
    where: {
      workspaceId: actor.workspaceId,
      ...teamScopeFilter(hidden),
      ...(tag ? { tags: { has: tag.slice(0, 40) } } : {}),
      ...(query
        ? { title: { contains: query.slice(0, 200), mode: "insensitive" } }
        : {}),
    },
    orderBy: [{ pinned: "desc" }, { title: "asc" }],
    take: 100,
  });
}
export async function findVisibleLink(actor: SearchActor, id: string) {
  const hidden = await hiddenTeamIds(actor.workspaceId, actor);
  return prisma.linkItem.findFirst({
    where: { id, workspaceId: actor.workspaceId, ...teamScopeFilter(hidden) },
  });
}
export async function pinnedLinks(actor: SearchActor) {
  const [hidden, marks] = await Promise.all([
    hiddenTeamIds(actor.workspaceId, actor),
    prisma.bookmark.findMany({
      where: {
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        entityType: "link",
      },
      orderBy: { sortOrder: "asc" },
      select: { entityId: true },
    }),
  ]);
  const links = await prisma.linkItem.findMany({
    where: {
      workspaceId: actor.workspaceId,
      AND: [
        teamScopeFilter(hidden),
        {
          OR: [{ pinned: true }, { id: { in: marks.map((m) => m.entityId) } }],
        },
      ],
    },
    orderBy: [{ pinned: "desc" }, { title: "asc" }],
    take: 12,
    select: { id: true, title: true, url: true },
  });
  return links;
}
