// Generated from app/w/[workspaceSlug]/analytics/drill/[metric]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { drillRecords } from "@/lib/analytics/queries";
import { forecastDrill } from "@/lib/analytics/forecast";

export async function loadAnalyticsDrillPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/analytics/drill/[metric]">) {
const { workspaceSlug, metric } = await params,
    actor = await requireWorkspace(workspaceSlug, "MEMBER"),
    raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
const data =
    metric === "forecast"
      ? await forecastDrill(actor, query)
      : await drillRecords(actor, metric, query);
return viewDto({ workspaceSlug, metric, data } as const);
}
