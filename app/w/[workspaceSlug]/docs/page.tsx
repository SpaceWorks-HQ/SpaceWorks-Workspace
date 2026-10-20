import Link from "next/link";
import { DocsSearch, NewPageButton } from "@/components/docs/DocsHomeControls";
import { Card, Chip, EmptyState, PageHeader, SectionHeading } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { canCreateDocs, VERIFY_DUE_SOON_DAYS, verificationState } from "@/lib/docs/rules";
import { searchDocs, visibleDocsWhere } from "@/lib/docs/service";
import { formatDate, formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Docs" };

function snippet(text: string, query: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  const start = Math.max(0, at > 40 ? at - 40 : 0);
  const piece = clean.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${piece}${start + 180 < clean.length ? "…" : ""}`;
}

/** Pages whose verification lapses before this moment are listed for review. */
function reviewHorizon() {
  return new Date(Date.now() + VERIFY_DUE_SOON_DAYS * 86_400_000);
}

export default async function DocsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/docs">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 200) : "";
  const visible = { ...visibleDocsWhere(workspace.id, membership.role), archivedAt: null };
  const soon = reviewHorizon();

  const [total, recent, review, results] = await Promise.all([
    prisma.doc.count({ where: visible }),
    prisma.doc.findMany({
      where: visible,
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, title: true, updatedAt: true, visibility: true, updatedBy: { select: { name: true } } },
    }),
    prisma.doc.findMany({
      where: { ...visible, verifiedUntil: { lte: soon }, OR: [{ verifiedById: user.id }, { verifiedById: null, createdById: user.id }] },
      orderBy: { verifiedUntil: "asc" },
      take: 10,
      select: { id: true, title: true, verifiedUntil: true },
    }),
    query ? searchDocs(workspace.id, membership.role, query) : Promise.resolve(null),
  ]);
  const canCreate = canCreateDocs(membership);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Docs" description="Guides, runbooks and notes the crew keeps together." actions={<NewPageButton />} />
      <DocsSearch query={query} autoFocus={search.focus === "search"} />

      {results ? (
        <section aria-labelledby="docs-results" className="flex flex-col gap-3">
          <SectionHeading as="h2" title={<span id="docs-results">Results for “{query}”</span>} description={`${results.length} ${results.length === 1 ? "page" : "pages"}`} />
          {results.length === 0 ? (
            <EmptyState title={`No pages match “${query}”.`}>Try fewer words, or check the archived pages.</EmptyState>
          ) : (
            <Card padding="none">
              <ul className="divide-y divide-line">
                {results.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/w/${workspace.slug}/docs/${doc.id}`} className="flex flex-col gap-1 px-5 py-4 transition-colors duration-[120ms] hover:bg-subtle">
                      <span className="flex items-center gap-2 text-title text-ink">
                        {doc.title}
                        {doc.visibility === "ADMINS" ? <Chip tone="ink" size="sm">Admins only</Chip> : null}
                      </span>
                      {doc.contentText ? <span className="line-clamp-2 text-body-ui text-ink-secondary">{snippet(doc.contentText, query)}</span> : null}
                      <span className="text-caption text-ink-muted">Edited {formatRelativeTime(doc.updatedAt, workspace.timezone)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      ) : total === 0 ? (
        <EmptyState patch title="No pages yet." action={canCreate ? <NewPageButton label="Write the first page" /> : undefined}>
          {canCreate ? "Start with a how-to for the laser cutter or the notes from the last build night." : "When members write guides and notes, they show up here."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {review.length > 0 ? (
          <section aria-labelledby="docs-review" className="flex flex-col gap-3">
            <SectionHeading as="h2" title={<span id="docs-review">Your pages to review</span>} description="Pages you verified, or wrote, whose check is due." />
            <Card padding="none">
                <ul className="divide-y divide-line">
                  {review.map((doc) => {
                    const state = verificationState(doc.verifiedUntil);
                    return (
                      <li key={doc.id}>
                        <Link href={`/w/${workspace.slug}/docs/${doc.id}`} className="flex min-h-14 flex-col justify-center gap-1 px-5 py-3 transition-colors duration-[120ms] hover:bg-subtle">
                          <span className="truncate text-body-ui font-semibold text-ink">{doc.title}</span>
                          <span className="flex items-center gap-2">
                            <Chip tone="warning" size="sm">{state === "expired" ? "Needs review" : "Review soon"}</Chip>
                            <span className="text-caption text-ink-muted">{state === "expired" ? "Lapsed" : "Due"} {formatDate(doc.verifiedUntil!, workspace.timezone)}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
          </section>
          ) : null}
          <section aria-labelledby="docs-recent" className="flex flex-col gap-3">
            <SectionHeading as="h2" title={<span id="docs-recent">Recently edited</span>} />
            <Card padding="none">
              <ul className="divide-y divide-line">
                {recent.map((doc) => (
                  <li key={doc.id}>
                    <Link href={`/w/${workspace.slug}/docs/${doc.id}`} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 transition-colors duration-[120ms] hover:bg-subtle">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-body-ui font-semibold text-ink">{doc.title}</span>
                        {doc.visibility === "ADMINS" ? <Chip tone="ink" size="sm">Admins only</Chip> : null}
                      </span>
                      <span className="shrink-0 text-right text-caption text-ink-muted">
                        {formatRelativeTime(doc.updatedAt, workspace.timezone)}
                        <span className="hidden sm:inline">{doc.updatedBy?.name ? ` · ${doc.updatedBy.name}` : ""}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}
