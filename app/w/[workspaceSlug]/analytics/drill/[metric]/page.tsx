import { requireWorkspace } from "@/lib/permissions";
import { drillRecords } from "@/lib/analytics/queries";
import { forecastDrill } from "@/lib/analytics/forecast";
import { Drill } from "@/components/analytics/Drill";
export default async function AnalyticsDrillPage({
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
  return <Drill data={data} slug={workspaceSlug} metric={metric} />;
}
