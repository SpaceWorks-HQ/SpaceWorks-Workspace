import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { toolSchemas } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import { FinanceError, financeAccess, lockFinance, type FinanceActor } from "../access";
import { financeNote } from "../service";

export async function addAccount(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.account.parse(input);
  return prisma.$transaction(async (tx) => {
    const row = await tx.financeAccount.create({
      data: {
        ...v,
        openingOn: dateOnly(v.openingOn),
        workspaceId: actor.workspace.id,
      },
    });
    await financeNote(tx, actor, "account", row.id, "created");
    return row.id;
  });
}

export async function accountBalance(
  client: DbClient,
  workspaceId: string,
  accountId: string,
  upTo: Date,
) {
  const account = await client.financeAccount.findFirst({
    where: { id: accountId, workspaceId },
  });
  if (!account || upTo < account.openingOn)
    throw new FinanceError(
      "Choose an account and a date on or after its opening date.",
    );
  const totals = await client.ledgerEntry.groupBy({
    by: ["kind"],
    where: {
      workspaceId,
      accountId,
      currency: account.currency,
      voidedAt: null,
      occurredOn: { gte: account.openingOn, lte: upTo },
    },
    _sum: { amountMinor: true },
  });
  const movements = await client.moneyControlMovement.aggregate({where:{workspaceId,accountId,currency:account.currency,occurredOn:{gte:account.openingOn,lte:upTo}},_sum:{amountMinor:true}});
  const balanceMinor =
    account.openingMinor + (movements._sum.amountMinor ?? 0) +
    totals.reduce(
      (n, r) => n + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amountMinor ?? 0),
      0,
    );
  return { account, balanceMinor };
}
export async function markReconciled(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.mark.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await tx.ledgerEntry.findFirst({
      where: { id: v.entryId, workspaceId: actor.workspace.id, voidedAt: null },
    });
    if (!row?.accountId)
      throw new FinanceError("Assign this entry to an account first.");
    if (row.privatePayroll) await financeAccess(actor, "PAY_MANAGE", tx);
    const account = await tx.financeAccount.findFirstOrThrow({
      where: { id: row.accountId, workspaceId: actor.workspace.id },
    });
    if (account.reconciledUpTo && row.occurredOn <= account.reconciledUpTo)
      throw new FinanceError(
        "This entry is already covered by a signed reconciliation.",
      );
    await tx.ledgerEntry.updateMany({
      where: { id: row.id, workspaceId: actor.workspace.id },
      data: { reconciledAt: v.reconciled ? new Date() : null },
    });
    await financeNote(tx, actor, "entry", row.id, "reconciliation_marked");
    return row.id;
  });
}
export async function reconcileAccount(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.reconcile.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const upTo = dateOnly(v.upTo);
    const { account, balanceMinor } = await accountBalance(
      tx,
      actor.workspace.id,
      v.accountId,
      upTo,
    );
    if (v.signOff) {
      if (account.reconciledUpTo && upTo <= account.reconciledUpTo)
        throw new FinanceError(
          "Choose a date after the last signed reconciliation.",
        );
      if (balanceMinor !== v.statementMinor)
        throw new FinanceError(
          "The statement and ledger differ. Correct or explain the entries before signing off.",
        );
      const remaining = await tx.ledgerEntry.count({
        where: {
          workspaceId: actor.workspace.id,
          accountId: account.id,
          voidedAt: null,
          reconciledAt: null,
          occurredOn: { gte: account.openingOn, lte: upTo },
        },
      });
      const uncheckedMovements = await tx.moneyControlMovement.count({where:{workspaceId:actor.workspace.id,accountId:account.id,reconciledAt:null,occurredOn:{gte:account.openingOn,lte:upTo}}});
      if (uncheckedMovements) throw new FinanceError("Mark transfers and deposit movements reconciled in Cash controls first.");
      if (remaining)
        throw new FinanceError(
          "Mark every entry through this date reconciled before signing off.",
        );
      await tx.financeAccount.updateMany({
        where: { id: account.id, workspaceId: actor.workspace.id },
        data: { reconciledUpTo: upTo },
      });
    }
    const row = await tx.financeReconciliation.create({
      data: {
        workspaceId: actor.workspace.id,
        accountId: account.id,
        upTo,
        statementMinor: v.statementMinor,
        ledgerMinor: BigInt(balanceMinor),
        notes: v.notes,
        signedOffAt: v.signOff ? new Date() : null,
        signedOffById: v.signOff ? actor.user.id : null,
      },
    });
    await financeNote(
      tx,
      actor,
      "reconciliation",
      row.id,
      v.signOff ? "signed" : "compared",
    );
    return row.id;
  });
}
