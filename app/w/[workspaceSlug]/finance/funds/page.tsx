import { notFound } from "next/navigation";
import { requireWorkspace, canViewFinance } from "@/lib/permissions";
import { FinanceToolScreen } from "@/components/finance/FinanceToolScreen";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import { financeToolView } from "@/lib/finance/tools/views";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/funds">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(actor.membership, actor.workspace)) notFound();
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as FinanceQuery;
  const view = await financeToolView(actor, "funds", query);
  return (
    <FinanceToolScreen
      actor={actor}
      section="funds"
      query={query}
      view={view}
    />
  );
}
