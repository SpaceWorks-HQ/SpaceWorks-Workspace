import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { getPublicBlog, listPublishedPosts } from "@/lib/blog/public";
import { summarise } from "@/lib/blog/rules";
import { absolute, blogPath, coverPath, feedPath, postPath } from "@/lib/blog/urls";
import { formatDate } from "@/lib/format/datetime";

function pageNumber(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : null;
}

export async function generateMetadata({ params, searchParams }: PageProps<"/blog/[workspaceSlug]">): Promise<Metadata> {
  const { workspaceSlug } = await params;
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) return { title: "Not found", robots: { index: false } };
  const page = pageNumber((await searchParams).page) ?? 1;
  const title = `${blog.name} blog`;
  const description = blog.tagline ?? blog.description ?? `Build logs, workshops and news from ${blog.name}.`;
  const canonical = absolute(page > 1 ? `${blogPath(blog.slug)}?page=${page}` : blogPath(blog.slug));
  return {
    title: { absolute: page > 1 ? `${title} · Page ${page}` : title },
    description: summarise(description),
    alternates: { canonical, types: { "application/rss+xml": [{ url: absolute(feedPath(blog.slug)), title }] } },
    robots: { index: true, follow: true },
    openGraph: { type: "website", title, description: summarise(description), url: canonical, siteName: blog.name, images: [{ url: absolute("/brand/og-default.png"), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description: summarise(description), images: [absolute("/brand/og-default.png")] },
  };
}

export default async function PublicBlogIndex({ params, searchParams }: PageProps<"/blog/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) notFound();
  const page = pageNumber((await searchParams).page);
  if (page === null) notFound();
  const { posts, pageCount, total } = await listPublishedPosts(blog.id, page);
  if (page > 1 && page > pageCount) notFound();
  const zone = blog.timezone;
  const href = blogPath(blog.slug);

  return (
    <div className="flex flex-col gap-12">
      <section className="flex max-w-[760px] flex-col gap-4">
        <p className="text-overline text-ink-muted">{blog.name}</p>
        <h1 className="text-display-m text-ink">
          Notes from <span className="font-accent">the workbench</span>
        </h1>
        {blog.tagline || blog.description ? <p className="text-body-l text-ink-secondary">{blog.tagline ?? blog.description}</p> : null}
      </section>

      {total === 0 ? (
        <EmptyState mood="sleepy" title="No posts yet.">
          The crew is still writing. Subscribe to the feed to hear about the first one.
        </EmptyState>
      ) : (
        <ol className="grid gap-6 md:grid-cols-2">
          {posts.map((post) => {
            const url = postPath(blog.slug, post.slug);
            const summary = summarise(post.excerpt ?? post.seoDescription ?? "", 220);
            return (
              <li key={post.id}>
                <article className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
                  {post.coverFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- scoped public cover route
                    <img src={coverPath(blog.slug, post.slug, post.coverFileId)} alt="" loading="lazy" className="aspect-[2/1] w-full border-b border-line object-cover" />
                  ) : (
                    <div aria-hidden className="aspect-[2/1] w-full border-b border-line bg-highlight-soft" />
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-5 sm:p-6">
                    <h2 className="text-h3 text-ink">
                      <Link href={url} className="underline-offset-4 hover:underline">
                        {post.title}
                      </Link>
                    </h2>
                    <p className="text-caption text-ink-muted">
                      {post.publishedAt ? <time dateTime={post.publishedAt.toISOString()}>{formatDate(post.publishedAt, zone)}</time> : null}
                      {post.authorName ? ` · ${post.authorName}` : ""}
                    </p>
                    {summary ? <p className="text-body-ui text-ink-secondary">{summary}</p> : null}
                    <Link href={url} className="mt-auto pt-2 text-label text-accent-text underline-offset-4 hover:underline" aria-label={`Read ${post.title}`}>
                      Read the post →
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}

      {pageCount > 1 ? (
        <nav aria-label="Blog pages" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Button asChild variant="secondary">
              <Link href={page === 2 ? href : `${href}?page=${page - 1}`} rel="prev">Newer posts</Link>
            </Button>
          ) : <span />}
          <span className="text-caption text-ink-muted">Page {page} of {pageCount}</span>
          {page < pageCount ? (
            <Button asChild variant="secondary">
              <Link href={`${href}?page=${page + 1}`} rel="next">Older posts</Link>
            </Button>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}
