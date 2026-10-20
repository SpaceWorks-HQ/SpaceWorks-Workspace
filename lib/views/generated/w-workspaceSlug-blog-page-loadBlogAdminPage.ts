// Generated from app/w/[workspaceSlug]/blog/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { listAdminPosts, type AdminPostFilter } from "@/lib/blog/queries";
import { canManageBlog, requireWorkspace } from "@/lib/permissions";
import { parseLedgerFilters } from "@/lib/finance/filters";
const FILTERS: Array<{ key: AdminPostFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "drafts", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];
const TONE = { Draft: "neutral", Scheduled: "info", Published: "success" } as const;
export async function loadBlogAdminPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/blog">) {
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
return viewDto({ workspace, page, filter, posts, counts, pageCount, listHref, now } as const);
}
