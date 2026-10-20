import { requireWorkspace } from "@/lib/permissions";
import {
  upcomingView,
  type RecurringQuery,
} from "@/lib/finance/recurring/queries";
import { DuesScreen } from "@/components/finance/recurring/Screen";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/dues">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "ADMIN");
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as RecurringQuery;
  const view = await upcomingView(actor, query);

  return <DuesScreen slug={workspaceSlug} view={view} query={query} />;
}
