import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import {
  canViewAnalytics,
  canManageAnalytics,
  canViewFinance,
  canViewPayroll,
} from "@/lib/roles";
import type { WorkspaceRole, Workspace } from "@prisma/client";
export type Actor = {
  user: { id: string };
  workspace: { id: string; slug: string; timezone: string };
  membership: { role: WorkspaceRole };
};
export class AnalyticsError extends Error {}
export type Access = {
  userId: string;
  workspace: Pick<
    Workspace,
    "id" | "slug" | "name" | "currency" | "timezone" | "financeVisibleToMembers"
  >;
  role: WorkspaceRole;
  admin: boolean;
  finance: boolean;
  payroll: boolean;
};
export async function analyticsAccess(
  actor: Actor,
  client: DbClient = prisma,
): Promise<Access> {
  const member = await client.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          slug: true,
          name: true,
          currency: true,
          timezone: true,
          financeVisibleToMembers: true,
        },
      },
    },
  });
  if (!member || !canViewAnalytics(member))
    throw new AnalyticsError(
      "That report is unavailable. Refresh and try again.",
    );
  const grant = await client.financePayrollGrant.findFirst({
    where: { workspaceId: member.workspace.id, userId: actor.user.id },
    select: { manage: true },
  });
  return {
    userId: actor.user.id,
    workspace: member.workspace,
    role: member.role,
    admin: canManageAnalytics(member),
    finance: canViewFinance(member, member.workspace),
    payroll: canViewPayroll(member, grant),
  };
}
