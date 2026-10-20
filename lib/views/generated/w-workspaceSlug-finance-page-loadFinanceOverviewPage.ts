// Generated from app/w/[workspaceSlug]/finance/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getFinanceSummary } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/format/money";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadFinanceOverviewPage({ params }: PageProps<"/w/[workspaceSlug]/finance">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace)) notFound();
const summary = await getFinanceSummary(workspace);
const base = `/w/${workspace.slug}/finance`;
const money = (minor: number) => formatMoney(minor, workspace.currency);
const manage = canManageFinance(membership);
const hasHistory = summary.series.some((m) => m.incomeMinor || m.expenseMinor) || summary.recent.length > 0 || summary.outstanding.count > 0 || summary.budgets.length > 0;
return viewDto({ workspace, summary, base, manage, hasHistory } as const);
}
