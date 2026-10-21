import "server-only";
import { prisma } from "@/lib/db";
import { financeAccess, type FinanceActor } from "@/lib/finance/tools/access";
import { files } from "./files";

export async function leaseFinanceView(
  actor: FinanceActor,
  leaseIds: string[],
) {
  await financeAccess(actor, "MANAGE");
  const rows = await prisma.recurringCostSchedule.findMany({
    where: { workspaceId: actor.workspace.id, leaseId: { in: leaseIds } },
    include: {
      dues: {
        include: {
          bill: { include: { payments: { orderBy: { paidOn: "desc" } } } },
        },
        orderBy: { dueOn: "desc" },
      },
    },
  });
  const deposits = await prisma.moneyControlRecord.findMany({
    where: {
      workspaceId: actor.workspace.id,
      kind: "DEPOSIT",
      payroll: false,
      id: { in: rows.flatMap((r) => (r.depositId ? [r.depositId] : [])) },
    },
    include: { movements: { orderBy: { occurredOn: "asc" } } },
  });
  return {
    rows,
    deposits,
    files: await files(
      actor,
      "BILL",
      rows.flatMap((r) => r.dues.map((d) => d.billId)),
    ),
  };
}
export type LeaseFinanceView = Awaited<ReturnType<typeof leaseFinanceView>>;
