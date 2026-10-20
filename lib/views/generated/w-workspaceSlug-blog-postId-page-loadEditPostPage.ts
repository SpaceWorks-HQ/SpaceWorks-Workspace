// Generated from app/w/[workspaceSlug]/blog/[postId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getAdminPost } from "@/lib/blog/queries";
import { postState } from "@/lib/blog/rules";
import { canManageBlog, requireWorkspace } from "@/lib/permissions";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { idSchema } from "@/lib/validation";

export async function loadEditPostPage({ params }: PageProps<"/w/[workspaceSlug]/blog/[postId]">) {
const { workspaceSlug, postId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageBlog(membership) || !idSchema.safeParse(postId).success) notFound();
const post = await getAdminPost(workspace.id, postId);
if (!post) notFound();
const listHref = `/w/${workspace.slug}/blog`;
const now = new Date();
const state = postState(post, now);
const tomorrow = zonedDatetimeLocalValue(new Date(now.getTime() + 86_400_000), workspace.timezone).slice(0, 10);
return viewDto({ workspace, post, listHref, state, tomorrow } as const);
}
