// Generated from app/blog/[workspaceSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getPublicBlog, listPublishedPosts } from "@/lib/blog/public";
import { blogPath } from "@/lib/blog/urls";
function pageNumber(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : null;
}
export async function loadPublicBlogIndex({ params, searchParams }: PageProps<"/blog/[workspaceSlug]">) {
const { workspaceSlug } = await params;
const blog = await getPublicBlog(workspaceSlug);
if (!blog) notFound();
const page = pageNumber((await searchParams).page);
if (page === null) notFound();
const { posts, pageCount, total } = await listPublishedPosts(blog.id, page);
if (page > 1 && page > pageCount) notFound();
const zone = blog.timezone;
const href = blogPath(blog.slug);
return viewDto({ blog, page, posts, pageCount, total, zone, href } as const);
}
