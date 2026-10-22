import { requireWorkspace } from "@/lib/permissions";
import {
  advancesView,
  type RecurringQuery,
} from "@/lib/finance/recurring/queries";
import { AdvancesScreen } from "@/components/finance/recurring/Advances";
import { localDate } from "@/lib/finance/dates";
export default async function Page({
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
  return (
    <AdvancesScreen
      slug={workspaceSlug}
      view={view}
      today={today}
      query={query}
    />
  );
}
