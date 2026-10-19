import Link from "next/link";
import { notFound } from "next/navigation";
import { NewPostButton } from "@/components/blog/NewPostButton";
import { Callout, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { listAdminPosts, type AdminPostFilter } from "@/lib/blog/queries";
import { postState } from "@/lib/blog/rules";
import { absolute, blogPath } from "@/lib/blog/urls";
import { formatDayTime, formatRelativeTime } from "@/lib/format/datetime";
import { canManageBlog, requireWorkspace } from "@/lib/permissions";
import { parseLedgerFilters } from "@/lib/finance/filters";

export const metadata = { title: "Blog" };

const FILTERS: Array<{ key: AdminPostFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "drafts", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];
const TONE = { Draft: "neutral", Scheduled: "info", Published: "success" } as const;

export default async function BlogAdminPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/blog">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageBlog(membership)) notFound();
  const query = await searchParams;
  const raw = String(query.status ?? "all");
  const { page } = parseLedgerFilters(query);
  const filter = (FILTERS.find((f) => f.key === raw)?.key ?? "all") as AdminPostFilter;
  const { posts, counts, pageCount } = await listAdminPosts(workspace.id, filter, page);
  if (page > pageCount) notFound();
  const listHref = `/w/${workspace.slug}/blog`;
  const now = new Date();
  const pageHref = (n: number) => `${listHref}?status=${filter}&page=${n}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blog"
        description="The community's public voice: build logs, workshop write-ups and news."
        actions={<NewPostButton slug={workspace.slug} listHref={listHref} />}
      />
      {workspace.blogEnabled ? (
        <p className="text-body-ui text-ink-secondary">
          Live at{" "}
          <a href={blogPath(workspace.slug)} target="_blank" rel="noreferrer" className="break-all text-accent-text underline underline-offset-4">
            {absolute(blogPath(workspace.slug))}
          </a>
        </p>
      ) : (
        <Callout tone="info" title="The public blog is switched off." action={<Link href={`/w/${workspace.slug}/settings`} className="text-label underline underline-offset-4">Open settings</Link>}>
          You can write and schedule posts now; nobody outside sees them until the blog is on.
        </Callout>
      )}
      {pageCount > 1 ? (
        <nav aria-label="Post pages" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-caption text-ink-muted">Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild variant="secondary"><Link href={pageHref(page - 1)}>Newer</Link></Button> : null}
            {page < pageCount ? <Button asChild variant="secondary"><Link href={pageHref(page + 1)}>Older</Link></Button> : null}
          </div>
        </nav>
      ) : null}
      <NavTabs
        label="Post status"
        items={FILTERS.map((f) => ({ href: f.key === "all" ? listHref : `${listHref}?status=${f.key}`, label: `${f.label} (${counts[f.key]})`, active: filter === f.key }))}
      />
      {posts.length === 0 ? (
        <EmptyState mood="sleepy" title={filter === "all" ? "No posts yet." : `No ${filter} posts.`} action={filter === "all" ? <NewPostButton slug={workspace.slug} listHref={listHref} label="Write the first post" /> : null}>
          {filter === "all" ? "Write up the last build night." : "Pick another tab above."}
        </EmptyState>
      ) : (
        <Table label="Blog posts">
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH>Author</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {posts.map((post) => {
              const state = postState(post, now);
              return (
                <TR key={post.id}>
                  <TD className="min-w-64">
                    <Link href={`${listHref}/${post.id}`} className="text-title text-ink underline-offset-4 hover:underline">
                      {post.title}
                    </Link>
                    <span className="block text-caption text-ink-muted">/{post.slug}</span>
                  </TD>
                  <TD>
                    <Chip tone={TONE[state]}>{state}</Chip>
                    {post.publishedAt ? <span className="mt-1 block text-caption text-ink-muted">{formatDayTime(post.publishedAt, workspace.timezone)}</span> : null}
                  </TD>
                  <TD className="text-ink-secondary">{post.author?.name ?? "Former member"}</TD>
                  <TD className="whitespace-nowrap text-ink-secondary">{formatRelativeTime(post.updatedAt, workspace.timezone, now)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
