import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PostArticle } from "@/components/blog/PostArticle";
import { getPublicBlog, getPublishedPost } from "@/lib/blog/public";
import { htmlToText, readingMinutes, summarise } from "@/lib/blog/rules";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";
import { absolute, blogPath, coverPath, feedPath, postPath } from "@/lib/blog/urls";
import { formatDate } from "@/lib/format/datetime";

async function load(workspaceSlug: string, postSlug: string) {
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) return null;
  const post = await getPublishedPost(blog.id, postSlug);
  return post ? { blog, post } : null;
}

export async function generateMetadata({ params }: PageProps<"/blog/[workspaceSlug]/[postSlug]">): Promise<Metadata> {
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

export default async function PublicPostPage({ params }: PageProps<"/blog/[workspaceSlug]/[postSlug]">) {
  const { workspaceSlug, postSlug } = await params;
  const found = await load(workspaceSlug, postSlug);
  if (!found) notFound();
  const { blog, post } = found;
  const html = sanitizeBlogHtml(post.contentHtml);
  return (
    <div className="flex flex-col gap-10">
      <Link href={blogPath(blog.slug)} className="mx-auto w-full max-w-[720px] text-label text-ink-secondary underline-offset-4 hover:underline">
        ← All posts
      </Link>
      <PostArticle
        title={post.title}
        dateLabel={post.publishedAt ? formatDate(post.publishedAt, blog.timezone) : null}
        dateTime={post.publishedAt?.toISOString() ?? null}
        authorName={post.authorName}
        minutes={readingMinutes(htmlToText(html))}
        coverSrc={post.coverFileId ? coverPath(blog.slug, post.slug, post.coverFileId) : null}
        html={html}
      />
    </div>
  );
}
