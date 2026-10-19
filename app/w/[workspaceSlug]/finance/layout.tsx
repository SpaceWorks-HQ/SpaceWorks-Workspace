import { notFound } from "next/navigation";
import { FinanceTabs } from "@/components/finance/FinanceTabs";
import { PageHeader } from "@/components/ui/display";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

/** Finance frame: header and section tabs. Every page still checks access itself. */
export default async function FinanceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/finance">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewFinance(membership, workspace)) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 print:hidden">
        <PageHeader title="Finance" description="The kitty: money in, money out and invoices." />
        <FinanceTabs base={`/w/${workspace.slug}/finance`} canManage={canManageFinance(membership)} />
      </div>
      {children}
    </div>
  );
}
