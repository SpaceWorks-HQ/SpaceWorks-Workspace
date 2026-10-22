// Generated from app/w/[workspaceSlug]/finance/recurring/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { scheduleView, type RecurringQuery } from "@/lib/finance/recurring/queries";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/recurring">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "ADMIN");
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as RecurringQuery;
const view = await scheduleView(actor, query);
return viewDto({ query, view } as const);
}
