// Generated from app/blog/[workspaceSlug]/[postSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getPublicBlog, getPublishedPost } from "@/lib/blog/public";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";
async function load(workspaceSlug: string, postSlug: string) {
  const blog = await getPublicBlog(workspaceSlug);
  if (!blog) return null;
  const post = await getPublishedPost(blog.id, postSlug);
  return post ? { blog, post } : null;
}
export async function loadPublicPostPage({ params }: PageProps<"/blog/[workspaceSlug]/[postSlug]">) {
const { workspaceSlug, postSlug } = await params;
const found = await load(workspaceSlug, postSlug);
if (!found) notFound();
const { blog, post } = found;
const html = sanitizeBlogHtml(post.contentHtml);
return viewDto({ blog, post, html } as const);
}
