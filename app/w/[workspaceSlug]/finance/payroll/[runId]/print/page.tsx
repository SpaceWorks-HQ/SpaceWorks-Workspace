import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import {
  auditPayView,
  financeAccess,
  FinanceError,
} from "@/lib/finance/tools/access";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { PrintButton } from "@/components/finance/PrintButton";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import { label, payTotals } from "@/lib/finance/tools-rules";
import "../../../tools-print.css";
export default async function Page({
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
  return (
    <div className="flex flex-col gap-5">
      <div className="print:hidden">
        <PrintButton />
      </div>
      <div id="finance-print">
        <Card>
          <CardHeader
            title={`${actor.workspace.name} payslip`}
            description={`${run.profile.name} · ${run.month}`}
            action={<Chip>{label(run.status)}</Chip>}
          />
          <dl className="divide-y divide-line">
            {[
              ["Gross", run.grossMinor],
              ["Allowances", run.allowancesMinor],
              ["PF", run.pfMinor],
              ["ESI", run.esiMinor],
              ["Professional tax", run.ptMinor],
              ["TDS", run.tdsMinor],
              ["Advances recovered", run.advancesMinor],
              ["Other deductions", run.otherMinor],
              ["Total deductions", totals.deductionsMinor],
              ["Net pay", run.netMinor],
            ].map(([name, n]) => (
              <div key={name} className="flex justify-between gap-4 py-3">
                <dt>{name}</dt>
                <dd className="font-semibold tabular-nums">
                  {formatMoney(Number(n), c)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4">
            {run.paidOn ? `Paid ${formatDay(run.paidOn)}` : "Not paid"} ·{" "}
            {run.reference ?? "No payment reference"}
          </p>
          <p className="mt-4 text-caption text-ink-muted">
            Private payroll record. Manually recorded in Space Works Workspace.
          </p>
        </Card>
      </div>
    </div>
  );
}
