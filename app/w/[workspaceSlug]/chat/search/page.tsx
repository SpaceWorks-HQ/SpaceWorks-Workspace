import { SearchResults } from "@/components/chat/SearchResults";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Search messages" };

/** Search across every conversation the member can read. */
export default async function ChatSearchPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/chat/search">) {
  const { workspaceSlug } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 200) : "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-4 py-3">
        <h1 className="text-h4 text-ink">Search messages</h1>
        <p className="text-caption text-ink-muted">Channels you can read and your direct messages.</p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <SearchResults autoFocus initialQuery={query} />
      </div>
    </div>
  );
}
