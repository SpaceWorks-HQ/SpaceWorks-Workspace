import { buildRssFeed } from "@/lib/blog/feed";
import { getPublicBlog, listFeedPosts } from "@/lib/blog/public";
import { htmlToText, summarise } from "@/lib/blog/rules";
import { absolute, blogPath, feedPath, postPath } from "@/lib/blog/urls";

export const dynamic = "force-dynamic";

/** RSS 2.0 feed of the latest published posts. */
export async function GET(_request: Request, ctx: RouteContext<"/blog/[workspaceSlug]/rss.xml">) {
  const { workspaceSlug } = await ctx.params;
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const posts = await listFeedPosts(blog.id);
  const xml = buildRssFeed(
    {
      title: `${blog.name} blog`,
      url: absolute(blogPath(blog.slug)),
      feedUrl: absolute(feedPath(blog.slug)),
      description: blog.tagline ?? blog.description ?? `Build logs, workshops and news from ${blog.name}.`,
      language: blog.defaultLocale,
    },
    posts.map((post) => ({
      title: post.title,
      url: absolute(postPath(blog.slug, post.slug)),
      description: summarise(post.excerpt || post.seoDescription || htmlToText(post.contentHtml), 400),
      publishedAt: post.publishedAt!,
      author: post.author?.name ?? null,
    })),
  );
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
