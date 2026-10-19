import Link from "next/link";
import { notFound } from "next/navigation";
import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import { getPublicBlog } from "@/lib/blog/public";
import { blogPath, feedPath } from "@/lib/blog/urls";

/**
 * Public blog frame (no session needed). A disabled blog, an archived or
 * unknown workspace all answer 404 here and again in each page.
 */
export default async function PublicBlogLayout({ children, params }: LayoutProps<"/blog/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) notFound();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[1040px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href={blogPath(blog.slug)} className="flex min-w-0 items-center gap-3" aria-label={`${blog.name} blog home`}>
            <SpaceWorksLogo variant="lockup-horizontal" height={36} label={null} className="hidden md:inline-flex" />
            <SpaceWorksLogo variant="symbol" height={48} label={null} className="md:hidden" />
            <span aria-hidden className="hidden h-7 w-px bg-line-strong md:block" />
            <span className="truncate text-title text-ink">{blog.name}</span>
          </Link>
          <a href={feedPath(blog.slug)} className="inline-flex min-h-11 shrink-0 items-center text-label text-accent-text underline-offset-4 hover:underline">
            RSS feed
          </a>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1040px] flex-1 px-4 py-10 focus:outline-none sm:px-6 sm:py-14">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1040px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-caption text-ink-muted sm:px-6">
          <span>Written by the {blog.name} crew, a Space Works community.</span>
          <a href={feedPath(blog.slug)} className="underline underline-offset-4">
            Subscribe with RSS
          </a>
        </div>
      </footer>
    </div>
  );
}
