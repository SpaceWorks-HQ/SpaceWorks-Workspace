import "server-only";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import {
  hiddenTeamIds,
  teamScopeFilter,
} from "@/lib/teamAccess";

export async function financePickers(actor: FinanceActor, payroll = false) {
  await financeAccess(actor, payroll ? "PAY_VIEW" : "VIEW");
  const workspaceId = actor.workspace.id;
  const hidden = await hiddenTeamIds(workspaceId, {
    userId: actor.user.id,
    role: actor.membership.role,
  });
  const [funds, centres, accounts, categories, budgets, members, projects] =
    await Promise.all([
      prisma.financeFund.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { name: "asc" },
      }),
      prisma.financeCostCentre.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { name: "asc" },
      }),
      prisma.financeAccount.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
      }),
      prisma.financeCategory.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, kind: true },
      }),
      prisma.budget.findMany({
        where: { workspaceId },
        orderBy: { periodStart: "desc" },
        select: { id: true, name: true, currency: true },
      }),
      prisma.membership.findMany({
        where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } },
        orderBy: { user: { name: "asc" } },
        select: { userId: true, role: true, user: { select: { name: true } } },
      }),
      prisma.project.findMany({
        where: {
          workspaceId,
          status: { not: "ARCHIVED" },
          ...teamScopeFilter(hidden),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
  return {
    funds,
    centres,
    accounts: accounts.map((a) => ({
      ...a,
      openingOn: a.openingOn.toISOString().slice(0, 10),
      reconciledUpTo: a.reconciledUpTo?.toISOString().slice(0, 10) ?? null,
    })),
    categories,
    budgets,
    members: members.map((m) => ({
      id: m.userId,
      name: m.user.name ?? "Former member",
      role: m.role,
    })),
    projects,
  };
}
export type FinancePickers = Awaited<ReturnType<typeof financePickers>>;
