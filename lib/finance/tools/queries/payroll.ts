import "server-only";
import { prisma } from "@/lib/db";
import {
  auditPayView,
  financeAccess,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import {
  toolPeriod,
  type FinanceQuery,
} from "./period";

export async function payrollData(actor: FinanceActor, query: FinanceQuery) {
  const { payrollManage } = await financeAccess(actor, "PAY_VIEW");
  const p = toolPeriod(actor, query),
    workspaceId = actor.workspace.id;
  return prisma.$transaction(
    async (tx) => {
      await financeAccess(actor, "PAY_VIEW", tx);
      const profiles = await tx.financePayProfile.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          userId: true,
          kind: true,
          currency: true,
          rateMinor: true,
          rateBasis: true,
          pfApplicable: true,
          esiApplicable: true,
          ptApplicable: true,
          tdsSection: true,
          costCentreId: true,
          archivedAt: true,
        },
      });
      const runs = await tx.financePayRun.findMany({
        where: { workspaceId, month: p.month },
        include: { profile: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      // Audit every viewed record inside the transaction before returning any salary data.
      for (const profile of profiles)
        await auditPayView(actor, "pay_profile", profile.id, tx);
      for (const run of runs) await auditPayView(actor, "pay_run", run.id, tx);
      return { profiles, runs, manage: payrollManage, period: p };
    },
    { timeout: 30000 },
  );
}
