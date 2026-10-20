import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { FinanceTabs } from "@/components/finance/FinanceTabs";
import { PageHeader } from "@/components/ui/display";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

/** Finance frame: header and section tabs. Every page still checks access itself. */
export default async function FinanceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/finance">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const grant = await prisma.financePayrollGrant.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } });
  const payroll = !!grant || membership.role === "OWNER";
  const view = canViewFinance(membership, workspace);
  if (!view && !payroll) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 print:hidden">
        <PageHeader title="Finance" description="Money in, money out and the records behind it." />
        <FinanceTabs base={`/w/${workspace.slug}/finance`} canManage={canManageFinance(membership)} canView={view} payroll={payroll} />
      </div>
      {children}
    </div>
  );
}
