import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/permissions";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.id ? { user: { id: session.id } } : null }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import * as blog from "@/lib/blog/service";
import { findPublicCover, getPublicBlog, getPublishedPost, listFeedPosts, listPublishedPosts } from "@/lib/blog/public";
import { listAdminPosts } from "@/lib/blog/queries";
import { createPostAction, savePostAction, setCoverAction } from "@/app/actions/blog";
import { GET as cover } from "@/app/blog/[workspaceSlug]/[postSlug]/cover/route";
import { GET as rss } from "@/app/blog/[workspaceSlug]/rss.xml/route";
import { GET as sitemap } from "@/app/blog/[workspaceSlug]/sitemap.xml/route";
import { deleteObjects, putObject } from "@/lib/storage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@blog-${suffix}.test`;
const slug = `blog-${suffix}`;
const otherSlug = `other-blog-${suffix}`;
let ctx: WorkspaceContext;
let foreign: WorkspaceContext;
let member: string;
let guest: string;
const now = new Date("2026-10-01T00:00:00Z");
const request = new Request("http://localhost/blog");
const xmlContext = () => ({ params: Promise.resolve({ workspaceSlug: slug }) });
const coverContext = (postSlug: string) => ({ params: Promise.resolve({ workspaceSlug: slug, postSlug }) });
async function post(title: string) {
  const result = await blog.createPost(ctx, title);
  if (!result.ok) throw new Error(result.error);
  const id = result.data!.id;
  const saved = await blog.savePost(ctx, id, { title, slug: title.toLowerCase().replaceAll(" ", "-"), contentHtml: "<p>Build night notes.</p>", excerpt: "From the workbench", seoTitle: null, seoDescription: null });
  expect(saved.ok).toBe(true);
  return id;
}
async function file(workspaceId = ctx.workspace.id, contentType = "image/png", folder = "/blog/covers") {
  return prisma.fileObject.create({ data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${uniqueSuffix()}/cover.png`, filename: "cover.png", contentType, folder, size: 68 } });
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

beforeAll(async () => {
  const owner = await createUser(`owner${domain}`);
  const outsider = await createUser(`outsider${domain}`);
  member = (await createUser(`member${domain}`)).id;
  guest = (await createUser(`guest${domain}`)).id;
  const workspace = await createWorkspace(slug, owner.id);
  await createWorkspace(otherSlug, outsider.id);
  await addMember(workspace.id, member, "MEMBER");
  await addMember(workspace.id, guest, "GUEST");
  await prisma.workspace.update({ where: { id: workspace.id }, data: { blogEnabled: true } });
  session.id = owner.id;
  ctx = (await getWorkspaceForAction(slug))!;
  session.id = outsider.id;
  foreign = (await getWorkspaceForAction(otherSlug))!;
  session.id = owner.id;
}, 60_000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({ where: { workspace: { slug: { in: [slug, otherSlug] } } }, select: { storageKey: true } });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup([slug, otherSlug], domain);
  await prisma.$disconnect();
});

describe.sequential("blog CMS", () => {
  it.each(["member", "guest", "anonymous"])("denies %s publishing access", async (role) => {
    session.id = role === "member" ? member : role === "guest" ? guest : "";
    expect(await createPostAction(slug, { title: "Denied" })).toMatchObject({ ok: false });
  });
  it("keeps post slugs unique, including maximum-length titles", async () => {
    const title = "a".repeat(60);
    const results = await Promise.all([blog.createPost(ctx, title), blog.createPost(ctx, title), blog.createPost(ctx, title)]);
    expect(results.every((r) => r.ok)).toBe(true);
    const posts = await prisma.blogPost.findMany({ where: { workspaceId: ctx.workspace.id, title } });
    expect(new Set(posts.map((p) => p.slug)).size).toBe(3);
    expect(posts.every((p) => p.slug.length <= 60)).toBe(true);
  });
  it("sanitises saves and rejects duplicate or reserved slugs", async () => {
    session.id = ctx.user.id;
    const id = await post("Sanitised");
    expect(await savePostAction(slug, { postId: id, title: "Safe", slug: "safe", contentHtml: '<script>bad()</script><p onclick="bad()">Good</p>' })).toMatchObject({ ok: true });
    expect((await prisma.blogPost.findFirstOrThrow({ where: { id, workspaceId: ctx.workspace.id } })).contentHtml).toBe("<p>Good</p>");
    expect(await savePostAction(slug, { postId: id, title: "Safe", slug: "preview", contentHtml: "<p>Good</p>" })).toMatchObject({ ok: false });
    const other = await post("Other");
    expect(await savePostAction(slug, { postId: other, title: "Other", slug: "safe", contentHtml: "<p>Good</p>" })).toMatchObject({ ok: false });
  });
  it("refuses post and cover mutations from another workspace", async () => {
    const id = await post("Tenant boundary");
    expect(await blog.publishPost(foreign, id)).toMatchObject({ ok: false });
    expect(await blog.deletePost(foreign, id)).toMatchObject({ ok: false });
    expect(await blog.setCover(foreign, id, null)).toMatchObject({ ok: false });
    expect(await getPublishedPost(foreign.workspace.id, "tenant-boundary", now)).toBeNull();
  });
  it("uploads only valid raster covers and removes replaced files", async () => {
    session.id = ctx.user.id;
    const id = await post("Uploaded cover");
    const form = new FormData(); form.set("postId", id);
    form.set("cover", new File(["<svg/>"], "cover.svg", { type: "image/svg+xml" }));
    expect(await setCoverAction(slug, form)).toMatchObject({ ok: false });
    form.set("cover", new File(["corrupt"], "cover.png", { type: "image/png" }));
    expect(await setCoverAction(slug, form)).toMatchObject({ ok: false });
    form.set("cover", new File([png], "cover.png", { type: "image/png" }));
    const uploaded = await setCoverAction(slug, form);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    expect(await findPublicCover(slug, "uploaded-cover", now)).toBeNull();
    await blog.publishPost(ctx, id, now);
    expect((await cover(request, coverContext("uploaded-cover"))).status).toBe(200);
    expect(await blog.setCover(ctx, id, null)).toMatchObject({ ok: true });
    expect((await prisma.fileObject.findFirstOrThrow({ where: { id: uploaded.data!.coverFileId!, workspaceId: ctx.workspace.id } })).deletedAt).not.toBeNull();
    expect((await cover(request, coverContext("uploaded-cover"))).status).toBe(404);
  });
  it("keeps a body in published and scheduled posts", async () => {
    const values = { title: "Still writing", slug: "still-writing", contentHtml: "<p></p>", excerpt: null, seoTitle: null, seoDescription: null };
    const id = await post("Still writing");
    await blog.schedulePost(ctx, id, new Date("2099-01-01"), now);
    expect(await blog.savePost(ctx, id, values)).toMatchObject({ ok: false });
    await blog.publishPost(ctx, id, now);
    expect(await blog.savePost(ctx, id, values)).toMatchObject({ ok: false });
    await blog.unpublishPost(ctx, id);
    expect(await blog.savePost(ctx, id, values)).toMatchObject({ ok: true });
  });
  it("retires the replaced cover when uploads race", async () => {
    const id = await post("Concurrent covers");
    const results = await Promise.all([1, 2].map((n) => blog.setCover(ctx, id, new File([png], `concurrent-${n}.png`, { type: "image/png" }))));
    expect(results.every((result) => result.ok)).toBe(true);
    const current = await prisma.blogPost.findFirstOrThrow({ where: { id, workspaceId: ctx.workspace.id } });
    const files = await prisma.fileObject.findMany({ where: { workspaceId: ctx.workspace.id, filename: { startsWith: "concurrent-" }, deletedAt: null } });
    expect(files.map((f) => f.id)).toEqual([current.coverFileId]);
  });
  it("paginates the CMS without making drafts public", async () => {
    await prisma.blogPost.createMany({ data: Array.from({ length: 51 }, (_, n) => ({ workspaceId: foreign.workspace.id, title: `Draft ${n}`, slug: `draft-${n}` })) });
    const first = await listAdminPosts(foreign.workspace.id, "drafts", 1);
    const second = await listAdminPosts(foreign.workspace.id, "drafts", 2);
    expect(first.pageCount).toBe(2);
    expect(first.posts).toHaveLength(50);
    expect(second.posts).toHaveLength(1);
    expect(new Set([...first.posts, ...second.posts].map((p) => p.id)).size).toBe(51);
    expect((await listPublishedPosts(foreign.workspace.id, 1)).posts).toEqual([]);
  });
});

describe.sequential("public blog", () => {
  it("hides drafts, schedules and future-dated publications from pages and XML", async () => {
    const draft = await post("Hidden draft");
    const scheduled = await post("Hidden scheduled");
    const future = await post("Hidden future");
    const live = await post("Public notes");
    await blog.schedulePost(ctx, scheduled, new Date("2099-01-01"), now);
    await blog.publishPost(ctx, future, new Date("2099-01-01"));
    await blog.publishPost(ctx, live, now);
    expect(await getPublishedPost(ctx.workspace.id, "hidden-draft", now)).toBeNull();
    expect(await getPublishedPost(ctx.workspace.id, "hidden-scheduled", now)).toBeNull();
    expect(await getPublishedPost(ctx.workspace.id, "hidden-future", now)).toBeNull();
    expect(await getPublishedPost(ctx.workspace.id, "public-notes", now)).not.toBeNull();
    const listed = await listPublishedPosts(ctx.workspace.id, 1, now);
    expect(listed.posts.some((p) => [draft, scheduled, future].includes(p.id))).toBe(false);
    expect((await listFeedPosts(ctx.workspace.id, 50, now)).some((p) => p.slug.startsWith("hidden"))).toBe(false);
    for (const route of [rss, sitemap]) {
      const response = await route(request, xmlContext());
      expect(response.status).toBe(200);
      const xml = await response.text();
      expect(xml).toContain("public-notes");
      expect(xml).not.toContain("hidden-draft");
      expect(xml).not.toContain("hidden-scheduled");
      expect(xml).not.toContain("hidden-future");
    }
  });
  it("publishes due drafts once across concurrent replicas and cancels schedules", async () => {
    const id = await post("Due today");
    await blog.schedulePost(ctx, id, new Date(now.getTime() + 120_000), now);
    await Promise.all([blog.publishDuePosts(new Date(now.getTime() + 180_000)), blog.publishDuePosts(new Date(now.getTime() + 180_000))]);
    expect(await prisma.auditEvent.count({ where: { workspaceId: ctx.workspace.id, targetId: id, action: "blog.post_published" } })).toBe(1);
    expect(await prisma.searchDocument.findFirst({ where: { workspaceId: ctx.workspace.id, entityId: id, entityType: "blog_post" } })).not.toBeNull();
    await blog.unpublishPost(ctx, id);
    await blog.publishDuePosts(new Date("2100-01-01"));
    expect(await getPublishedPost(ctx.workspace.id, "due-today", new Date("2100-01-01"))).toBeNull();
    expect(await prisma.searchDocument.findFirst({ where: { workspaceId: ctx.workspace.id, entityId: id } })).toBeNull();
  });
  it("serves only that published post's cover and refuses private or foreign files", async () => {
    const id = await post("Cover boundary");
    const coverFile = await file();
    await putObject(coverFile.storageKey, png, "image/png");
    await prisma.blogPost.update({ where: { id, workspaceId: ctx.workspace.id }, data: { coverFileId: coverFile.id } });
    expect((await cover(request, coverContext("cover-boundary"))).status).toBe(404);
    await blog.publishPost(ctx, id, now);
    const response = await cover(request, coverContext("cover-boundary"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const otherFile = await file(foreign.workspace.id);
    await prisma.blogPost.update({ where: { id, workspaceId: ctx.workspace.id }, data: { coverFileId: otherFile.id } });
    expect((await cover(request, coverContext("cover-boundary"))).status).toBe(404);
    const privateFile = await file(ctx.workspace.id, "image/png", "/finance/receipts");
    await prisma.blogPost.update({ where: { id, workspaceId: ctx.workspace.id }, data: { coverFileId: privateFile.id } });
    expect((await cover(request, coverContext("cover-boundary"))).status).toBe(404);
    const pdf = await file(ctx.workspace.id, "application/pdf");
    await prisma.blogPost.update({ where: { id, workspaceId: ctx.workspace.id }, data: { coverFileId: pdf.id } });
    expect((await cover(request, coverContext("cover-boundary"))).status).toBe(404);
    await prisma.fileObject.update({ where: { id: coverFile.id }, data: { deletedAt: new Date() } });
    await prisma.blogPost.update({ where: { id, workspaceId: ctx.workspace.id }, data: { coverFileId: coverFile.id } });
    expect((await cover(request, coverContext("cover-boundary"))).status).toBe(404);
  });
  it("returns 404 for every public surface when disabled, archived or unknown", async () => {
    for (const data of [{ blogEnabled: false }, { blogEnabled: true, archivedAt: new Date() }]) {
      await prisma.workspace.update({ where: { id: ctx.workspace.id }, data });
      expect(await getPublicBlog(slug)).toBeNull();
      expect(await getPublishedPost(ctx.workspace.id, "public-notes", now)).toBeNull();
      expect((await rss(request, xmlContext())).status).toBe(404);
      expect((await sitemap(request, xmlContext())).status).toBe(404);
      expect((await cover(request, coverContext("cover-boundary"))).status).toBe(404);
    }
    expect(await getPublicBlog(`missing-${suffix}`)).toBeNull();
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { blogEnabled: true, archivedAt: null } });
  });
});
