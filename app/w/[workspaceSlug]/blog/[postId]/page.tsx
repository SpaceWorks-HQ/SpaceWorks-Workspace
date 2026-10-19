import Link from "next/link";
import { notFound } from "next/navigation";
import { PostEditor } from "@/components/blog/PostEditor";
import { getAdminPost } from "@/lib/blog/queries";
import { postState } from "@/lib/blog/rules";
import { sanitizeBlogHtml } from "@/lib/blog/sanitize";
import { absolute, postPath } from "@/lib/blog/urls";
import { formatDayTime, formatTimeZoneName } from "@/lib/format/datetime";
import { canManageBlog, requireWorkspace } from "@/lib/permissions";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { idSchema } from "@/lib/validation";

export const metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: PageProps<"/w/[workspaceSlug]/blog/[postId]">) {
  const { workspaceSlug, postId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageBlog(membership) || !idSchema.safeParse(postId).success) notFound();
  const post = await getAdminPost(workspace.id, postId);
  if (!post) notFound();
  const listHref = `/w/${workspace.slug}/blog`;
  const now = new Date();
  const state = postState(post, now);
  // Default schedule: tomorrow at 10:00 in the workspace time zone.
  const tomorrow = zonedDatetimeLocalValue(new Date(now.getTime() + 86_400_000), workspace.timezone).slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <Link href={listHref} className="text-label text-ink-secondary underline-offset-4 hover:underline">
        ← Back to posts
      </Link>
      <h1 className="sr-only">Edit {post.title}</h1>
      <PostEditor
        slug={workspace.slug}
        listHref={listHref}
        blogEnabled={workspace.blogEnabled}
        blogPrefix={`/blog/${workspace.slug}/`}
        defaultScheduleAt={post.publishedAt && state === "Scheduled" ? zonedDatetimeLocalValue(post.publishedAt, workspace.timezone) : `${tomorrow}T10:00`}
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt ?? "",
          contentHtml: sanitizeBlogHtml(post.contentHtml),
          seoTitle: post.seoTitle ?? "",
          seoDescription: post.seoDescription ?? "",
          coverFileId: post.coverFile && !post.coverFile.deletedAt ? post.coverFile.id : null,
          state,
          whenLabel: post.publishedAt ? `${formatDayTime(post.publishedAt, workspace.timezone)} ${formatTimeZoneName(post.publishedAt, workspace.timezone)}` : null,
          publicUrl: absolute(postPath(workspace.slug, post.slug)),
        }}
      />
    </div>
  );
}
