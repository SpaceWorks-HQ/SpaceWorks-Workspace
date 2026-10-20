// Generated from app/w/[workspaceSlug]/blog/[postId]/preview/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getAdminPost } from "@/lib/blog/queries";
import { postState } from "@/lib/blog/rules";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";
import { canManageBlog, requireWorkspace } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";

export async function loadPreviewPostPage({ params }: PageProps<"/w/[workspaceSlug]/blog/[postId]/preview">) {
const { workspaceSlug, postId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageBlog(membership) || !idSchema.safeParse(postId).success) notFound();
const post = await getAdminPost(workspace.id, postId);
if (!post) notFound();
const html = sanitizeBlogHtml(post.contentHtml);
const state = postState(post);
const cover = post.coverFile && !post.coverFile.deletedAt ? `/api/files/${post.coverFile.id}` : null;
return viewDto({ workspace, post, html, state, cover } as const);
}
