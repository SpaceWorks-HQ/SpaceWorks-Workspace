import "server-only";
import { prisma } from "@/lib/db";
import {
  assertOpen,
  FinanceError,
  lockFinance,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { recoverySchema } from "../rules";
import { note } from "../service";

import { readAdvance } from "./access";

export async function recoverAdvance(actor: FinanceActor, input: unknown) {
  const v = recoverySchema.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const recovery = await tx.staffAdvanceRecovery.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.id },
    });
    if (!recovery) throw new FinanceError("Choose an advance instalment.");
    const row = await readAdvance(actor, recovery.advanceId, true, tx);
    if (!row.depositId || !row.paidOn)
      throw new FinanceError("Record the advance payment first.");
    const facts = JSON.stringify({
      recoveryId: v.id,
      amountMinor: v.amountMinor,
      paidOn: v.paidOn,
      reference: v.reference,
      payRunId: v.payRunId,
    });
    const prior = await tx.moneyControlEvent.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        action: "ADVANCE_RECOVERY",
        reference: v.operationKey,
      },
    });
    if (prior) {
      if (prior.recordId !== row.depositId || prior.notes !== facts)
        throw new FinanceError(
          "This recovery key was used for different details.",
        );
      return row.id;
    }
    if (v.amountMinor > recovery.amountMinor - recovery.recoveredMinor)
      throw new FinanceError("The recovery exceeds the instalment balance.");
    if (new Date(v.paidOn) < row.paidOn)
      throw new FinanceError("Recovery cannot precede the advance payment.");
    await assertOpen(tx, actor.workspace.id, new Date(v.paidOn), row.accountId);
    if (v.payRunId) {
      const run = await tx.financePayRun.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: v.payRunId,
          profileId: row.profileId,
          profile: { userId: row.userId },
          status: "PAID",
          currency: row.currency,
        },
      });
      if (!run || run.paidOn?.toISOString().slice(0, 10) !== v.paidOn)
        throw new FinanceError("Choose this person's paid run and paid date.");
      const used = await tx.moneyControlEvent.findMany({
        where: { workspaceId: actor.workspace.id, action: "ADVANCE_RECOVERY" },
      });
      const recovered = used.reduce((n, e) => {
        try {
          const d = JSON.parse(e.notes);
          return n + (d.payRunId === run.id ? Number(d.amountMinor) : 0);
        } catch {
          return n;
        }
      }, 0);
      if (recovered + v.amountMinor > run.advancesMinor)
        throw new FinanceError(
          "This exceeds the advance recovery entered in the pay run.",
        );
    } else
      await tx.moneyControlMovement.create({
        data: {
          workspaceId: actor.workspace.id,
          recordId: row.depositId,
          accountId: row.accountId,
          amountMinor: v.amountMinor,
          currency: row.currency,
          occurredOn: new Date(v.paidOn),
          reference: v.reference,
          operationKey: v.operationKey,
        },
      });
    await tx.staffAdvanceRecovery.updateMany({
      where: { workspaceId: actor.workspace.id, id: v.id },
      data: { recoveredMinor: { increment: v.amountMinor } },
    });
    await tx.moneyControlRecord.updateMany({
      where: { workspaceId: actor.workspace.id, id: row.depositId },
      data: { settledMinor: { increment: v.amountMinor } },
    });
    await tx.moneyControlEvent.create({
      data: {
        workspaceId: actor.workspace.id,
        recordId: row.depositId,
        actorId: actor.user.id,
        action: "ADVANCE_RECOVERY",
        reference: v.operationKey,
        notes: facts,
      },
    });
    await note(tx, actor, row.id, "advance_recovered");
    return row.id;
  });
}
