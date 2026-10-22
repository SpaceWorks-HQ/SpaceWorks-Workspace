// Generated from app/w/[workspaceSlug]/finance/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadFinanceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/finance">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const grant = await prisma.financePayrollGrant.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } });
const payroll = !!grant || membership.role === "OWNER";
const view = canViewFinance(membership, workspace);
if (!view && !payroll) notFound();
return viewDto({ workspace, membership, payroll, view } as const);
}
