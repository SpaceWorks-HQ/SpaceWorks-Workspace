import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AdminPostFilter = "all" | "drafts" | "scheduled" | "published";

export function adminPostWhere(workspaceId: string, filter: AdminPostFilter): Prisma.BlogPostWhereInput {
  if (filter === "drafts") return { workspaceId, status: "DRAFT", publishedAt: null };
  if (filter === "scheduled") return { workspaceId, status: "DRAFT", publishedAt: { not: null } };
  if (filter === "published") return { workspaceId, status: "PUBLISHED" };
  return { workspaceId };
}

export async function listAdminPosts(workspaceId: string, filter: AdminPostFilter, page = 1) {
  const [posts, drafts, scheduled, published] = await Promise.all([
    prisma.blogPost.findMany({
      where: adminPostWhere(workspaceId, filter),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: { id: true, title: true, slug: true, status: true, publishedAt: true, updatedAt: true, author: { select: { name: true } } },
    }),
    prisma.blogPost.count({ where: adminPostWhere(workspaceId, "drafts") }),
    prisma.blogPost.count({ where: adminPostWhere(workspaceId, "scheduled") }),
    prisma.blogPost.count({ where: adminPostWhere(workspaceId, "published") }),
  ]);
  const counts = { all: drafts + scheduled + published, drafts, scheduled, published };
  return { posts, counts, pageCount: Math.max(1, Math.ceil(counts[filter] / 50)) };
}

export async function getAdminPost(workspaceId: string, id: string) {
  return prisma.blogPost.findFirst({
    where: { id, workspaceId },
    include: { author: { select: { name: true } }, coverFile: { select: { id: true, deletedAt: true } } },
  });
}
