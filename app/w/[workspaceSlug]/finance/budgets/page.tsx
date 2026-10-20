import { notFound } from "next/navigation";
import { requireWorkspace, canViewFinance } from "@/lib/permissions";
import { FinanceToolScreen } from "@/components/finance/FinanceToolScreen";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/budgets">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(actor.membership, actor.workspace)) notFound();
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as FinanceQuery;
  return <FinanceToolScreen actor={actor} section="budgets" query={query} />;
}
