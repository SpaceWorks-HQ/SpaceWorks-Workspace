import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/display";
import { QueryFilters } from "@/components/saved-views/QueryFilters";
import { requireWorkspace } from "@/lib/permissions";
import { searchDocuments, normaliseSearch } from "@/lib/search/query";
import { searchActor, safeWorkspaceUrl } from "@/lib/shell/context";
import { listSavedViews } from "@/lib/shell/views";
import { SavedViews } from "@/components/saved-views/SavedViews";
import { isActionRateLimited } from "@/lib/actionRateLimit";
export const metadata = { title: "Search" };
export default async function SearchPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/search">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const input = await searchParams;
  const q = normaliseSearch(typeof input.q === "string" ? input.q : "");
  const type =
    typeof input.type === "string" ? input.type.slice(0, 40) : undefined;
  const offset = Number(input.offset) || 0;
  const limited = q
    ? await isActionRateLimited("search", `${ctx.workspace.id}:${ctx.user.id}`)
    : false;
  const [hits, views] = await Promise.all([
    limited ? [] : searchDocuments(searchActor(ctx), q, type, offset),
    listSavedViews(searchActor(ctx), "search"),
  ]);
  const groups = Object.groupBy(hits, (h) => h.entityType);
  const base = `/w/${workspaceSlug}/search`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Search"
        description="Find tasks, conversations, docs and more across your workspace."
      />
      <QueryFilters q={q} type={type} />
      <nav aria-label="Result type" className="flex flex-wrap gap-2">
        {[
          "",
          "task",
          "doc",
          "message",
          "project",
          "link",
          "community_event",
        ].map((t) => (
          <Link
            key={t}
            className={`inline-flex min-h-11 items-center rounded-md px-3 ${t === (type ?? "") ? "bg-primary text-on-primary" : "underline"}`}
            href={`${base}?q=${encodeURIComponent(q)}${t ? `&type=${t}` : ""}`}
            aria-current={t === (type ?? "") ? "page" : undefined}
          >
            {t.replaceAll("_", " ") || "All"}
          </Link>
        ))}
      </nav>
      <p role="status" className="text-ink-muted">
        {limited
          ? "Search is busy. Wait a minute and try again."
          : q
            ? `${hits.length} results on this page.`
            : "Enter a word to start searching."}
      </p>
      {q && !hits.length && !limited ? (
        <Card>No matches yet. Try a different word.</Card>
      ) : null}
      {Object.entries(groups).map(([kind, rows]) => (
        <Card key={kind}>
          <h2 className="mb-3 text-title capitalize">
            {kind.replaceAll("_", " ")}
          </h2>
          <ul className="divide-y divide-line">
            {rows?.map((hit) => (
              <li key={hit.id}>
                <Link
                  href={safeWorkspaceUrl(hit.url, workspaceSlug) ?? base}
                  className="block min-h-11 break-words py-3 text-label hover:underline"
                >
                  {hit.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {hits.length === 50 ? (
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`${base}?q=${encodeURIComponent(q)}&offset=${offset + 50}${type ? `&type=${encodeURIComponent(type)}` : ""}`}
        >
          More results
        </Link>
      ) : null}
      <SavedViews
        slug={workspaceSlug}
        userId={ctx.user.id}
        entityType="search"
        filters={{ q, ...(type ? { type } : {}) }}
        views={views}
        base={base}
      />
    </div>
  );
}
