import "server-only";

import { Prisma } from "@prisma/client";
import { actionError, SAVE_FAILED, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma, type DbClient, type Tx } from "@/lib/db";
import { retireUnlinkedFile } from "@/lib/finance/service";
import type { WorkspaceContext } from "@/lib/permissions";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { RASTER_IMAGE_TYPES, deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import { htmlToText, postSlugFromTitle, postSlugProblem, uniquePostSlug } from "@/lib/blog/rules";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";
import { postPath } from "@/lib/blog/urls";

/**
 * Blog mutations. Callers (Server Actions) have resolved the workspace and
 * checked `canManageBlog`; every write still filters by workspaceId.
 */

type Ctx = Pick<WorkspaceContext, "user" | "workspace">;
export const COVER_MAX_BYTES = 8 * 1024 * 1024;
const NOT_FOUND = "That post isn't available any more. Refresh and try again.";
const SEARCH_TYPE = "blog_post";

async function lockPost(tx: Tx, workspaceId: string, postId: string) {
  await tx.$queryRaw`SELECT "id" FROM "BlogPost" WHERE "id" = ${postId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  return tx.blogPost.findFirst({ where: { id: postId, workspaceId } });
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function takenSlugs(client: DbClient, workspaceId: string, base: string, exceptId?: string) {
  const rows = await client.blogPost.findMany({ where: { workspaceId, slug: { startsWith: base.slice(0, 50) }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { slug: true } });
  return new Set(rows.map((row) => row.slug));
}

async function indexPublished(client: DbClient, workspace: { id: string; slug: string }, post: { id: string; title: string; excerpt: string | null; contentHtml: string; slug: string }) {
  await indexSearchDocument(
    { workspaceId: workspace.id, entityType: SEARCH_TYPE, entityId: post.id, title: post.title, body: `${post.excerpt ?? ""} ${htmlToText(post.contentHtml)}`.trim(), url: postPath(workspace.slug, post.slug) },
    client,
  );
}

export async function createPost(ctx: Ctx, title: string): Promise<ActionResult<{ id: string }>> {
  const { workspace, user } = ctx;
  const base = postSlugFromTitle(title);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = uniquePostSlug(base, await takenSlugs(prisma, workspace.id, base));
    try {
      const post = await prisma.$transaction(async (tx) => {
        const created = await tx.blogPost.create({ data: { workspaceId: workspace.id, title, slug, authorId: user.id } });
        await recordAuditEvent({ action: "blog.post_created", workspaceId: workspace.id, actorId: user.id, targetType: "blog_post", targetId: created.id, client: tx });
        return created;
      });
      return { ok: true, data: { id: post.id } };
    } catch (error) {
      if (!isUniqueViolation(error)) return actionError(SAVE_FAILED);
    }
  }
  return actionError(SAVE_FAILED);
}

export type PostValues = { title: string; slug: string; excerpt: string | null; contentHtml: string; seoTitle: string | null; seoDescription: string | null };

export async function savePost(ctx: Ctx, postId: string, values: PostValues): Promise<ActionResult<{ slug: string }>> {
  const { workspace, user } = ctx;
  const problem = postSlugProblem(values.slug);
  if (problem) return actionError(problem, { slug: [problem] });
  const existing = await prisma.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, status: true, publishedAt: true, slug: true } });
  if (!existing) return actionError(NOT_FOUND);
  const contentHtml = sanitizeBlogHtml(values.contentHtml);
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await lockPost(tx, workspace.id, postId);
      if (!current) return actionError(NOT_FOUND);
      if ((current.status === "PUBLISHED" || current.publishedAt) && !htmlToText(contentHtml)) {
        return actionError("Keep some text in a live or scheduled post. Unpublish it to clear the body.", { contentHtml: ["Write something in the post before saving."] });
      }
      const post = await tx.blogPost.update({
        where: { id: existing.id, workspaceId: workspace.id },
        data: { title: values.title, slug: values.slug, excerpt: values.excerpt, contentHtml, seoTitle: values.seoTitle, seoDescription: values.seoDescription },
      });
      if (post.status === "PUBLISHED") await indexPublished(tx, workspace, post);
      await recordAuditEvent({ action: "blog.post_updated", workspaceId: workspace.id, actorId: user.id, targetType: "blog_post", targetId: post.id, metadata: { slugChanged: existing.slug !== post.slug }, client: tx });
      return { ok: true as const, data: { slug: post.slug } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("Another post already uses that address.", { slug: ["Another post already uses that address."] });
    return actionError(SAVE_FAILED);
  }
}

async function readyToPublish(tx: Tx, workspaceId: string, postId: string) {
  const post = await lockPost(tx, workspaceId, postId);
  if (!post) return { error: NOT_FOUND } as const;
  if (!post.title.trim()) return { error: "Give the post a title first." } as const;
  if (!htmlToText(post.contentHtml)) return { error: "Write something in the post before publishing." } as const;
  return { post } as const;
}

export async function publishPost(ctx: Ctx, postId: string, now: Date = new Date()): Promise<ActionResult> {
  const { workspace, user } = ctx;
  return prisma.$transaction(async (tx) => {
    const ready = await readyToPublish(tx, workspace.id, postId);
    if ("error" in ready) return actionError(ready.error!);
    const claimed = await tx.blogPost.updateMany({ where: { id: ready.post.id, workspaceId: workspace.id, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: now } });
    if (claimed.count) {
      const post = await tx.blogPost.findFirstOrThrow({ where: { id: ready.post.id, workspaceId: workspace.id } });
      await afterPublish(tx, workspace, post, user.id);
    }
    return { ok: true as const };
  });
}

async function afterPublish(tx: DbClient, workspace: { id: string; slug: string }, post: { id: string; title: string; excerpt: string | null; contentHtml: string; slug: string }, actorId: string | null) {
  await indexPublished(tx, workspace, post);
  await recordActivity({ workspaceId: workspace.id, actorId, verb: "published", entityType: SEARCH_TYPE, entityId: post.id, summary: `Published "${post.title.slice(0, 200)}" on the blog` }, tx);
  await recordAuditEvent({ action: "blog.post_published", workspaceId: workspace.id, actorId, targetType: "blog_post", targetId: post.id, metadata: { scheduled: actorId === null }, client: tx, ...(actorId === null ? { ip: null } : {}) });
}

export async function schedulePost(ctx: Ctx, postId: string, at: Date, now: Date = new Date()): Promise<ActionResult> {
  const { workspace, user } = ctx;
  if (at.getTime() < now.getTime() + 60_000) return actionError("Pick a time at least a minute from now.", { publishAt: ["Pick a time at least a minute from now."] });
  return prisma.$transaction(async (tx) => {
    const ready = await readyToPublish(tx, workspace.id, postId);
    if ("error" in ready) return actionError(ready.error!);
    if (ready.post.status === "PUBLISHED") return actionError("This post is already live. Unpublish it first to schedule it.");
    await tx.blogPost.updateMany({ where: { id: ready.post.id, workspaceId: workspace.id, status: "DRAFT" }, data: { publishedAt: at } });
    await recordAuditEvent({ action: "blog.post_scheduled", workspaceId: workspace.id, actorId: user.id, targetType: "blog_post", targetId: ready.post.id, client: tx });
    return { ok: true as const };
  });
}

/** Back to a plain draft: unpublishes a live post or cancels a schedule. */
export async function unpublishPost(ctx: Ctx, postId: string): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.blogPost.updateMany({ where: { id: postId, workspaceId: workspace.id }, data: { status: "DRAFT", publishedAt: null } });
    if (result.count === 0) return 0;
    await removeSearchDocument(SEARCH_TYPE, postId, tx);
    await recordAuditEvent({ action: "blog.post_unpublished", workspaceId: workspace.id, actorId: user.id, targetType: "blog_post", targetId: postId, client: tx });
    return result.count;
  });
  return changed ? { ok: true } : actionError(NOT_FOUND);
}

export async function deletePost(ctx: Ctx, postId: string): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const post = await prisma.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, coverFileId: true } });
  if (!post) return actionError(NOT_FOUND);
  await prisma.$transaction(async (tx) => {
    await tx.blogPost.delete({ where: { id: post.id, workspaceId: workspace.id } });
    await retireUnlinkedFile(tx, workspace.id, post.coverFileId);
    await removeSearchDocument(SEARCH_TYPE, post.id, tx);
    await recordAuditEvent({ action: "blog.post_deleted", workspaceId: workspace.id, actorId: user.id, targetType: "blog_post", targetId: post.id, client: tx });
  });
  return { ok: true };
}

export async function setCover(ctx: Ctx, postId: string, file: File | null): Promise<ActionResult<{ coverFileId: string | null }>> {
  const { workspace, user } = ctx;
  const post = await prisma.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, coverFileId: true } });
  if (!post) return actionError(NOT_FOUND);
  let uploadedKey: string | null = null;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const current = await lockPost(tx, workspace.id, postId);
        if (!current) return actionError(NOT_FOUND);
        let coverFileId: string | null = null;
        if (file) {
          const upload = await uploadWorkspaceFile({ workspaceId: workspace.id, uploadedById: user.id, file, folder: "/blog/covers", allowedTypes: RASTER_IMAGE_TYPES, maxBytes: COVER_MAX_BYTES, client: tx });
          if (!upload.ok) return actionError(upload.error, { cover: [upload.error] });
          uploadedKey = upload.file.storageKey;
          coverFileId = upload.file.id;
        }
        await tx.blogPost.updateMany({ where: { id: post.id, workspaceId: workspace.id }, data: { coverFileId } });
        if (current.coverFileId && current.coverFileId !== coverFileId) await retireUnlinkedFile(tx, workspace.id, current.coverFileId);
        await recordAuditEvent({ action: file ? "blog.cover_updated" : "blog.cover_removed", workspaceId: workspace.id, actorId: user.id, targetType: "blog_post", targetId: post.id, client: tx });
        return { ok: true as const, data: { coverFileId } };
      },
      { timeout: 30_000 },
    );
    if (!result.ok && uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return result;
  } catch {
    if (uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return actionError(SAVE_FAILED);
  }
}

/**
 * Scheduled publishing (lib/scheduled/financeBlog.ts). Each due post is
 * claimed with a conditional update, so concurrent replicas publish it once.
 */
export async function publishDuePosts(now: Date = new Date()): Promise<number> {
  const due = await prisma.blogPost.findMany({
    where: { status: "DRAFT", publishedAt: { lte: now }, workspace: { archivedAt: null } },
    orderBy: { publishedAt: "asc" },
    take: 50,
    select: { id: true, workspace: { select: { id: true, slug: true, archivedAt: true } } },
  });
  let published = 0;
  for (const candidate of due) {
    if (candidate.workspace.archivedAt) continue;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.blogPost.updateMany({ where: { id: candidate.id, workspaceId: candidate.workspace.id, status: "DRAFT", publishedAt: { lte: now } }, data: { status: "PUBLISHED" } });
      if (claimed.count === 0) return;
      const post = await tx.blogPost.findFirstOrThrow({ where: { id: candidate.id, workspaceId: candidate.workspace.id } });
      await afterPublish(tx, candidate.workspace, post, null);
      published += 1;
    });
  }
  return published;
}
