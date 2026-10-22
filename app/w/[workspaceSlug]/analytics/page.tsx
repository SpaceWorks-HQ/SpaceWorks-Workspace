import { requireWorkspace } from "@/lib/permissions";
import { loadDashboard, listPresets } from "@/lib/analytics/queries";
import { adjustmentList } from "@/lib/analytics/service";
import { cashForecast } from "@/lib/analytics/forecast";
import { Dashboard } from "@/components/analytics/Dashboard";
import { querySchema } from "@/lib/analytics/metrics";
export const metadata = { title: "Reports and analytics" };
export default async function AnalyticsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/analytics">) {
  const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "MEMBER"),
    raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const preset = flat.preset
    ? (await listPresets(actor)).find((p) => p.id === flat.preset)
    : null;
  const q = querySchema.parse(preset?.query ?? flat),
    data = await loadDashboard(actor, q);
  const unscoped =
    !q.fund && !q.centre && !q.team && !q.project && !q.programme;
  const forecast =
    data.admin && unscoped && ["home", "finance"].includes(q.section)
      ? await cashForecast(actor, q)
      : null;
  const adjustments =
    data.admin && q.section === "finance"
      ? await adjustmentList(actor, q.currency ?? actor.workspace.currency)
      : [];
  return (
    <Dashboard
      data={data}
      slug={workspaceSlug}
      forecast={forecast}
      adjustments={adjustments}
    />
  );
}
