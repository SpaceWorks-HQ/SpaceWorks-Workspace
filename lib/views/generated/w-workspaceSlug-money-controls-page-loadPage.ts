// Generated from app/w/[workspaceSlug]/money-controls/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { loadControlsView } from "@/lib/moneyControls/queries";
import type { ControlsQuery } from "@/lib/moneyControls/rules";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/money-controls">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
const view = await loadControlsView(
    actor,
    "cash",
    query as ControlsQuery,
    query.edit,
    query.new,
  );
return viewDto({ view } as const);
}
