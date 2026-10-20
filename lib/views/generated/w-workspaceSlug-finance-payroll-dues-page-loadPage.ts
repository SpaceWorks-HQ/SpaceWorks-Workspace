// Generated from app/w/[workspaceSlug]/finance/payroll/dues/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canViewPayroll } from "@/lib/roles";
import { requireWorkspace } from "@/lib/permissions";
import { upcomingView, type RecurringQuery } from "@/lib/finance/recurring/queries";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/payroll/dues">) {
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
if (!canViewPayroll(actor.membership, grant)) notFound();
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as RecurringQuery;
const view = await upcomingView(actor, query, true);
return viewDto({ query, view } as const);
}
