// Generated from app/w/[workspaceSlug]/finance/advances/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { advancesView, type RecurringQuery } from "@/lib/finance/recurring/queries";
import { localDate } from "@/lib/finance/dates";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/advances">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as RecurringQuery;
const view = await advancesView(actor, query);
const today = localDate(new Date(), actor.workspace.timezone);
return viewDto({ query, view, today } as const);
}
