import "server-only";
import type { MoneyControlRecord } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { assertOpen, lockFinance } from "@/lib/finance/tools/access";
import { controlsAccess, controlRecord, type ControlsActor } from "../access";
import { required } from "./validation";

export async function movement(
  tx: DbClient,
  row: MoneyControlRecord,
  accountId: string,
  amountMinor: number,
  date: Date,
  reference: string,
  key: string,
) {
  await assertOpen(tx, row.workspaceId, date, accountId);
  await tx.moneyControlMovement.create({
    data: {
      workspaceId: row.workspaceId,
      recordId: row.id,
      accountId,
      amountMinor,
      currency: row.currency,
      occurredOn: date,
      reference,
      operationKey: key,
    },
  });
}

export async function markControlMovement(actor: ControlsActor, id: string) {
  const a = await controlsAccess(actor);
  required(a.manage, "You don't have access to do that.");
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    required(
      (await controlsAccess(actor, tx)).manage,
      "You don't have access to do that.",
    );
    const row = await tx.moneyControlMovement.findFirst({
      where: { workspaceId: actor.workspace.id, id },
    });
    required(row, "That movement is unavailable.");
    const record = await controlRecord(actor,row.recordId,false,tx);
    if(record.payroll) required((await controlsAccess(actor,tx)).payrollManage,"Payroll movements need a Manage payroll grant.");
    await assertOpen(tx, row.workspaceId, row.occurredOn, row.accountId);
    await tx.moneyControlMovement.updateMany({
      where: { workspaceId: row.workspaceId, id },
      data: { reconciledAt: new Date() },
    });
    await recordAuditEvent({
      workspaceId: row.workspaceId,
      actorId: actor.user.id,
      action: "moneycontrols.movement_reconciled",
      targetType: "money_control",
      targetId: row.recordId,
      client: tx,
    });
    return row.recordId;
  });
}
