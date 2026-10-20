// Generated from app/w/[workspaceSlug]/finance/payroll/[runId]/print/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { auditPayView, financeAccess, FinanceError } from "@/lib/finance/tools/access";
import { payTotals } from "@/lib/finance/tools-rules";

export async function loadPage({
  params,
}: PageProps<"/w/[workspaceSlug]/finance/payroll/[runId]/print">) {
const { workspaceSlug, runId } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
try {
    await financeAccess(actor, "PAY_VIEW");
  } catch (e) {
    if (e instanceof FinanceError) notFound();
    throw e;
  }
const run = await prisma.$transaction(async (tx) => {
    await financeAccess(actor, "PAY_VIEW", tx);
    const row = await tx.financePayRun.findFirst({
      where: { workspaceId: actor.workspace.id, id: runId },
      include: { profile: { select: { name: true, kind: true } } },
    });
    if (row) await auditPayView(actor, "pay_run", row.id, tx);
    return row;
  });
if (!run) notFound();
const c = run.currency,
    totals = payTotals(run);
return viewDto({ actor, run, c, totals } as const);
}
