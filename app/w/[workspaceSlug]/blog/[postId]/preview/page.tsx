import Link from "next/link";
import { notFound } from "next/navigation";
import { PostArticle } from "@/components/blog/PostArticle";
import { Callout } from "@/components/ui/display";
import { getAdminPost } from "@/lib/blog/queries";
import { htmlToText, postState, readingMinutes } from "@/lib/blog/rules";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";
import { formatDate } from "@/lib/format/datetime";
import { canManageBlog, requireWorkspace } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";

export const metadata = { title: "Preview post", robots: { index: false, follow: false } };

/** Admin-only preview of any post (drafts included), rendered as readers will see it. */
export default async function PreviewPostPage({ params }: PageProps<"/w/[workspaceSlug]/blog/[postId]/preview">) {
  const { workspaceSlug, postId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageBlog(membership) || !idSchema.safeParse(postId).success) notFound();
  const post = await getAdminPost(workspace.id, postId);
  if (!post) notFound();
  const html = sanitizeBlogHtml(post.contentHtml);
  const state = postState(post);
  const cover = post.coverFile && !post.coverFile.deletedAt ? `/api/files/${post.coverFile.id}` : null;
  return (
    <div className="flex flex-col gap-6">
      <Callout tone="info" title={`Preview: ${state.toLowerCase()}.`} action={<Link href={`/w/${workspace.slug}/blog/${post.id}`} className="text-label underline underline-offset-4">Back to editing</Link>}>
        This is how the post will read on the public blog. Saved changes only.
      </Callout>
      <PostArticle
        title={post.title}
        dateLabel={post.publishedAt ? formatDate(post.publishedAt, workspace.timezone) : null}
        dateTime={post.publishedAt?.toISOString() ?? null}
        authorName={post.author?.name ?? null}
        minutes={readingMinutes(htmlToText(html))}
        coverSrc={cover}
        html={html}
      />
    </div>
  );
}
