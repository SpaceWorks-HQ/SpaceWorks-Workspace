// Generated from app/blog/[workspaceSlug]/[postSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getPublicBlog, getPublishedPost } from "@/lib/blog/public";
import { htmlToText, summarise } from "@/lib/blog/rules";
import { absolute, coverPath, feedPath, postPath } from "@/lib/blog/urls";
async function load(workspaceSlug: string, postSlug: string) {
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) return null;
  const post = await getPublishedPost(blog.id, postSlug);
  return post ? { blog, post } : null;
}
export async function loadgenerateMetadata({ params }: PageProps<"/blog/[workspaceSlug]/[postSlug]">) {
const { workspaceSlug, postSlug } = await params;
const found = await load(workspaceSlug, postSlug);
if (!found) return { title: "Not found", robots: { index: false } };
const { blog, post } = found;
const title = post.seoTitle || post.title;
const description = summarise(post.seoDescription || post.excerpt || htmlToText(post.contentHtml));
const url = absolute(postPath(blog.slug, post.slug));
const image = post.coverFileId ? absolute(coverPath(blog.slug, post.slug, post.coverFileId)) : absolute("/brand/og-default.png");
return {
    title: { absolute: `${title} · ${blog.name}` },
    description,
    alternates: { canonical: url, types: { "application/rss+xml": [{ url: absolute(feedPath(blog.slug)), title: `${blog.name} blog` }] } },
    robots: { index: true, follow: true },
    authors: post.authorName ? [{ name: post.authorName }] : undefined,
    openGraph: {
      type: "article",
      title,
      description,
      url,
      siteName: blog.name,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: post.authorName ? [post.authorName] : undefined,
      images: [{ url: image, ...(post.coverFileId ? {} : { width: 1200, height: 630 }) }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };

}
