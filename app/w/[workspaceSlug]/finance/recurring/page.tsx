import { requireWorkspace } from "@/lib/permissions";
import {
  scheduleView,
  type RecurringQuery,
} from "@/lib/finance/recurring/queries";
import { ScheduleScreen } from "@/components/finance/recurring/Screen";
export default async function Page({
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

  return <ScheduleScreen slug={workspaceSlug} view={view} query={query} />;
}
