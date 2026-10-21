import "server-only";
import { prisma } from "@/lib/db";
import { controlsAccess, type ControlsActor } from "../access";
import type { ControlPickers } from "../types";

export async function controlsPickers(
  actor: ControlsActor,
): Promise<ControlPickers> {
  const a = await controlsAccess(actor),
    workspaceId = actor.workspace.id;
  if (!a.manage) {
    const handovers = await prisma.moneyControlRecord.findMany({
      where: {
        workspaceId,
        kind: "HANDOVER",
        OR: [
          { ownerId: actor.user.id },
          { details: { path: ["outgoingId"], equals: actor.user.id } },
        ],
      },
      select: { accountId: true },
    });
    return {
      accounts: await prisma.financeAccount.findMany({
        where: {
          workspaceId,
          id: {
            in: handovers.flatMap((r) => (r.accountId ? [r.accountId] : [])),
          },
        },
        select: { id: true, name: true, currency: true },
      }),
      funds: [],
      assets: await prisma.asset.findMany({
        where: { workspaceId },
        select: { id: true, name: true },
      }),
      members: (
        await prisma.membership.findMany({
          where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } },
          select: { userId: true, user: { select: { name: true } } },
        })
      ).map((m) => ({ id: m.userId, name: m.user.name ?? "Former member" })),
      categories: [],
      records: [],
      compliance: [],
      checklists: [],
    };
  }
  const [
    accounts,
    funds,
    assets,
    members,
    categories,
    records,
    compliance,
    checklists,
  ] = await Promise.all([
    prisma.financeAccount.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currency: true },
    }),
    prisma.financeFund.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currency: true },
    }),
    prisma.asset.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.membership.findMany({
      where: {
        workspaceId,
        status: "ACTIVE",
        role: { not: "GUEST" },
        user: { disabledAt: null },
      },
      select: { userId: true, user: { select: { name: true } } },
    }),
    prisma.financeCategory.findMany({
      where: { workspaceId, archivedAt: null, kind: "EXPENSE" },
      select: { id: true, name: true },
    }),
    prisma.moneyControlRecord.findMany({
      where: {
        workspaceId,
        kind: { in: ["ASSET_CATEGORY", "TDS_DEDUCTION"] },
        status: { not: "CANCELLED" },
        ...(!a.payrollView ? { payroll: false } : {}),
      },
      select: { id: true, title: true, kind: true },
    }),
    prisma.governanceRecord.findMany({
      where: { workspaceId, kind: "OBLIGATION", archivedAt: null },
      select: { id: true, title: true },
    }),
    prisma.checklistRun.findMany({
      where: { workspaceId, kind: { in: ["ONBOARDING", "OFFBOARDING"] } },
      select: { id: true, title: true, subjectUserId: true },
    }),
  ]);
  return {
    accounts,
    funds,
    assets,
    members: members.map((m) => ({
      id: m.userId,
      name: m.user.name ?? "Former member",
    })),
    categories,
    records,
    compliance,
    checklists,
  };
}
