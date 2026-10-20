// Generated from app/w/[workspaceSlug]/finance/payroll/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canViewPayroll } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import { payrollView } from "@/lib/finance/tools/views";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/payroll">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const grant = await prisma.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
if (
    actor.membership.role !== "OWNER" &&
    !canViewPayroll(actor.membership, grant)
  )
    notFound();
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as FinanceQuery;
const view = await payrollView(actor, query);
return viewDto({ actor, query, view } as const);
}
