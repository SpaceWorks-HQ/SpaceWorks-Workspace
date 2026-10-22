import { requireWorkspace } from "@/lib/permissions";
import { ControlsScreen } from "@/components/moneyControls/Screen";
import { loadControlsView } from "@/lib/moneyControls/queries";
import type { ControlsQuery } from "@/lib/moneyControls/rules";
export const metadata = { title: "Money controls" };
export default async function Page({
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
  return <ControlsScreen view={view} />;
}
