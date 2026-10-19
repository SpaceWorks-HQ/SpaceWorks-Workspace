import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RASTER_IMAGE_TYPES } from "@/lib/storage";
import { POSTS_PER_PAGE } from "@/lib/blog/rules";

/**
 * Read side of the public blog. Nothing here needs a session, so every query
 * is pinned to: the workspace exists, is not archived and has the blog
 * switched on; the post is PUBLISHED with publishedAt in the past. Drafts,
 * scheduled posts and disabled blogs are indistinguishable from "not found".
 */

export async function getPublicBlog(workspaceSlug: string) {
  if (typeof workspaceSlug !== "string" || !/^[a-z0-9-]{1,64}$/.test(workspaceSlug)) return null;
  return prisma.workspace.findFirst({
    where: { slug: workspaceSlug, archivedAt: null, blogEnabled: true },
    select: { id: true, slug: true, name: true, tagline: true, description: true, defaultLocale: true, timezone: true },
  });
}

export function publishedWhere(workspaceId: string, now: Date = new Date()): Prisma.BlogPostWhereInput {
  return { workspaceId, workspace: { archivedAt: null, blogEnabled: true }, status: "PUBLISHED", publishedAt: { lte: now } };
}

const listSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  seoDescription: true,
  publishedAt: true,
  updatedAt: true,
  coverFileId: true,
  coverFile: { select: { deletedAt: true, contentType: true } },
  author: { select: { name: true } },
} satisfies Prisma.BlogPostSelect;

function visibleCover(post: { coverFileId: string | null; coverFile: { deletedAt: Date | null; contentType: string } | null }) {
  return post.coverFileId && post.coverFile && !post.coverFile.deletedAt && RASTER_IMAGE_TYPES.has(post.coverFile.contentType) ? post.coverFileId : null;
}

export async function listPublishedPosts(workspaceId: string, page: number, now: Date = new Date()) {
  const where = publishedWhere(workspaceId, now);
  const [total, posts] = await Promise.all([
    prisma.blogPost.count({ where }),
    prisma.blogPost.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * POSTS_PER_PAGE, take: POSTS_PER_PAGE, select: listSelect }),
  ]);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / POSTS_PER_PAGE)),
    posts: posts.map(({ coverFile, ...post }) => ({ ...post, coverFileId: visibleCover({ coverFileId: post.coverFileId, coverFile }), authorName: post.author?.name ?? null })),
  };
}

export async function getPublishedPost(workspaceId: string, postSlug: string, now: Date = new Date()) {
  if (!/^[a-z0-9-]{1,60}$/.test(postSlug)) return null;
  const post = await prisma.blogPost.findFirst({
    where: { ...publishedWhere(workspaceId, now), slug: postSlug },
    select: { ...listSelect, contentHtml: true, seoTitle: true },
  });
  if (!post) return null;
  const { coverFile, ...rest } = post;
  return { ...rest, coverFileId: visibleCover({ coverFileId: post.coverFileId, coverFile }), authorName: post.author?.name ?? null };
}

/** Everything the feed and sitemap need, newest first (capped). */
export async function listFeedPosts(workspaceId: string, take = 50, now: Date = new Date()) {
  return prisma.blogPost.findMany({
    where: publishedWhere(workspaceId, now),
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take,
    select: { slug: true, title: true, excerpt: true, seoDescription: true, contentHtml: true, publishedAt: true, updatedAt: true, author: { select: { name: true } } },
  });
}

// Reserve one URL for the blog index in the first sitemap. Select only the
// address and timestamp so large post bodies never enter the sitemap response.
export const SITEMAP_PAGE_SIZE = 49_999;

export async function sitemapPostCount(workspaceId: string) {
  return prisma.blogPost.count({ where: publishedWhere(workspaceId) });
}

export async function listSitemapPosts(workspaceId: string, page: number) {
  return prisma.blogPost.findMany({
    where: publishedWhere(workspaceId),
    orderBy: { id: "asc" },
    skip: (page - 1) * SITEMAP_PAGE_SIZE,
    take: SITEMAP_PAGE_SIZE,
    select: { slug: true, updatedAt: true },
  });
}

/**
 * The cover image of one published post, or null. The file must belong to
 * the same workspace, be a raster image and not be deleted; no other file is
 * ever reachable through this path.
 */
export async function findPublicCover(workspaceSlug: string, postSlug: string, now: Date = new Date()) {
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog || !/^[a-z0-9-]{1,60}$/.test(postSlug)) return null;
  const post = await prisma.blogPost.findFirst({
    where: {
      ...publishedWhere(blog.id, now), slug: postSlug,
      coverFile: { workspaceId: blog.id, folder: "/blog/covers", deletedAt: null, docId: null, taskId: null, ledgerReceipts: { none: {} }, messageAttachments: { none: {} } },
    },
    select: { coverFile: { select: { id: true, workspaceId: true, storageKey: true, contentType: true, size: true, deletedAt: true } } },
  });
  const file = post?.coverFile;
  if (!file || file.deletedAt || file.workspaceId !== blog.id || !RASTER_IMAGE_TYPES.has(file.contentType)) return null;
  return file;
}
