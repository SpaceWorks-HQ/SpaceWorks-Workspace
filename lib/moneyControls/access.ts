import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import {
  canManageMoneyControls,
  canReadMoneyControl,
  canManagePayroll,
  canViewPayroll,
  hasRoleAtLeast,
} from "@/lib/roles";
import { FinanceError, type FinanceActor } from "@/lib/finance/tools/access";
import type { MoneyControlRecord } from "@prisma/client";
export type ControlsActor = FinanceActor;
export async function controlsAccess(
  actor: ControlsActor,
  client: DbClient = prisma,
) {
  const member = await client.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
    include: { workspace: true },
  });
  if (!member || !hasRoleAtLeast(member.role, "MEMBER"))
    throw new FinanceError("You don't have access to do that.");
  const grant = await client.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  return {
    member,
    manage: canManageMoneyControls(member),
    payrollView: canViewPayroll(member, grant),
    payrollManage: canManagePayroll(member, grant),
  };
}
export async function controlRecord(
  actor: ControlsActor,
  recordId: string,
  write = false,
  client: DbClient = prisma,
) {
  const a = await controlsAccess(actor, client);
  const row = await client.moneyControlRecord.findFirst({
    where: { workspaceId: actor.workspace.id, id: recordId },
  });
  if (
    !row ||
    !canReadMoneyControl(a.member, actor.user.id, row) ||
    (write && !a.manage) ||
    (row.payroll && !(write ? a.payrollManage : a.payrollView))
  )
    throw new FinanceError(
      "That control record is unavailable. Refresh and try again.",
    );
  return row;
}
export function details(row: Pick<MoneyControlRecord, "details">) {
  return row.details as Record<string, unknown>;
}
