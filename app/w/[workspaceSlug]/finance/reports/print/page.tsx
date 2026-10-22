import { notFound } from "next/navigation";
import { requireWorkspace, canViewFinance } from "@/lib/permissions";
import { FinanceReportsScreen } from "@/components/finance/FinanceReports";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import { financeReportsView } from "@/lib/finance/tools/views";
import "../../tools-print.css";
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/reports/print">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(actor.membership, actor.workspace)) notFound();
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as FinanceQuery;
  const view = await financeReportsView(actor, query);
  return (
    <div id="finance-print">
      <FinanceReportsScreen actor={actor} query={query} view={view} print />
    </div>
  );
}
