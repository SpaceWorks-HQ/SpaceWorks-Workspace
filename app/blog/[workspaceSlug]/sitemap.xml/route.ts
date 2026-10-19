import { buildSitemap, buildSitemapIndex } from "@/lib/blog/feed";
import { getPublicBlog, listSitemapPosts, sitemapPostCount, SITEMAP_PAGE_SIZE } from "@/lib/blog/public";
import { absolute, blogPath, postPath, sitemapPath } from "@/lib/blog/urls";

export const dynamic = "force-dynamic";

/**
 * Per-workspace sitemap (the app-wide sitemap belongs to the shell). Lists
 * the blog index and every published post; drafts never appear.
 */
export async function GET(request: Request, ctx: RouteContext<"/blog/[workspaceSlug]/sitemap.xml">) {
  const { workspaceSlug } = await ctx.params;
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const pageCount = Math.max(1, Math.ceil(await sitemapPostCount(blog.id) / SITEMAP_PAGE_SIZE));
  const rawPage = new URL(request.url).searchParams.get("page");
  const page = rawPage === null ? 1 : Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > pageCount) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const headers = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (rawPage === null && pageCount > 1) {
    const urls = Array.from({ length: pageCount }, (_, n) => absolute(`${sitemapPath(blog.slug)}?page=${n + 1}`));
    return new Response(buildSitemapIndex(urls), { headers });
  }
  const posts = await listSitemapPosts(blog.id, page);
  const xml = buildSitemap([
    ...(page === 1 ? [{ url: absolute(blogPath(blog.slug)) }] : []),
    ...posts.map((post) => ({ url: absolute(postPath(blog.slug, post.slug)), lastModified: post.updatedAt })),
  ]);
  return new Response(xml, { headers });
}
