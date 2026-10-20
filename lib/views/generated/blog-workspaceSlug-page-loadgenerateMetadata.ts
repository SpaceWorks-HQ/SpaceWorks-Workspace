// Generated from app/blog/[workspaceSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getPublicBlog } from "@/lib/blog/public";
import { summarise } from "@/lib/blog/rules";
import { absolute, blogPath, feedPath } from "@/lib/blog/urls";
function pageNumber(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : null;
}
export async function loadgenerateMetadata({ params, searchParams }: PageProps<"/blog/[workspaceSlug]">) {
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
