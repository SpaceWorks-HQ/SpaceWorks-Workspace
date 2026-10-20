// Generated from app/blog/[workspaceSlug]/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getPublicBlog } from "@/lib/blog/public";

export async function loadPublicBlogLayout({ children, params }: LayoutProps<"/blog/[workspaceSlug]">) {
const { workspaceSlug } = await params;
const blog = await getPublicBlog(workspaceSlug);
if (!blog) notFound();
return viewDto({ blog } as const);
}
