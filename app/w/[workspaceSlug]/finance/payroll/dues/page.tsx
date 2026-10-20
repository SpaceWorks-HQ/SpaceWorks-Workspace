import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canViewPayroll } from "@/lib/roles";
import { requireWorkspace } from "@/lib/permissions";
import {
  upcomingView,
  type RecurringQuery,
} from "@/lib/finance/recurring/queries";
import { DuesScreen } from "@/components/finance/recurring/Screen";
export default async function Page({
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

  return <DuesScreen slug={workspaceSlug} view={view} query={query} />;
}
