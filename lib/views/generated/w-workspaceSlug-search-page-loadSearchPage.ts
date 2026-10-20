// Generated from app/w/[workspaceSlug]/search/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { searchDocuments, normaliseSearch } from "@/lib/search/query";
import { searchActor } from "@/lib/shell/context";
import { listSavedViews } from "@/lib/shell/views";
import { isActionRateLimited } from "@/lib/actionRateLimit";

export async function loadSearchPage({
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
return viewDto({ ctx, q, type, offset, limited, hits, views, groups, base } as const);
}
