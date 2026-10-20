// Generated from app/w/[workspaceSlug]/social/comments/[commentId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { socialComment } from "@/lib/social/queries";
import { safeSocialUrl } from "@/components/social/SocialNav";

export async function loadSocialCommentPage({ params }: PageProps<"/w/[workspaceSlug]/social/comments/[commentId]">) {
const { workspaceSlug, commentId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const comment = await socialComment(ctx, commentId);
if (!comment) notFound();
const [members, thread] = await Promise.all([prisma.membership.findMany({ where: { workspaceId: ctx.workspace.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] }, user: { disabledAt: null } }, select: { userId: true, user: { select: { name: true } } } }), prisma.socialComment.findMany({ where: { workspaceId: ctx.workspace.id, accountId: comment.accountId, postId: comment.postId, OR: [{ externalId: comment.parentExternalId ?? comment.externalId }, { parentExternalId: comment.parentExternalId ?? comment.externalId }] }, orderBy: { publishedAt: "asc" }, take: 100 })]);
const url = safeSocialUrl(comment.post.url);
return viewDto({ ctx, comment, members, thread, url } as const);
}
