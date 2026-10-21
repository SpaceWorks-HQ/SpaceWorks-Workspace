import "server-only";
import { prisma } from "@/lib/db";
import { toolSchemas } from "@/lib/finance/tools-rules";
import { dateOnly } from "@/lib/finance/dates";
import {
  FinanceError,
  assertOpen,
  financeAccess,
  lockFinance,
  unavailable,
  validateTags,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { claimStagedFiles } from "@/lib/finance/tools/files";
import { financeNote } from "./notes";

export async function addEntry(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.entry.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await assertOpen(
      tx,
      actor.workspace.id,
      dateOnly(v.occurredOn),
      v.accountId,
    );
    await validateTags(tx, actor.workspace.id, v, v.currency, v.kind);
    if (v.accountId) {
      const account = await tx.financeAccount.findFirstOrThrow({
        where: { id: v.accountId, workspaceId: actor.workspace.id },
      });
      if (dateOnly(v.occurredOn) < account.openingOn)
        throw new FinanceError(
          "Use a date on or after the account opening date.",
        );
    }
    const { fileIds, occurredOn, ...data } = v;
    const row = await tx.ledgerEntry.create({
      data: {
        ...data,
        occurredOn: dateOnly(occurredOn),
        workspaceId: actor.workspace.id,
        createdById: actor.user.id,
      },
    });
    const extractionUsed = await claimStagedFiles(
      tx,
      actor,
      fileIds,
      "LEDGER",
      row.id,
    );
    if (extractionUsed)
      await tx.ledgerEntry.updateMany({
        where: { workspaceId: actor.workspace.id, id: row.id },
        data: { extractionUsed: true },
      });
    await financeNote(
      tx,
      actor,
      "entry",
      row.id,
      "created",
      row.description,
      "spending",
    );
    return row.id;
  });
}

export async function saveEntryTags(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = toolSchemas.tags.parse(input);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const row = await tx.ledgerEntry.findFirst({
      where: {
        id: v.entryId,
        workspaceId: actor.workspace.id,
        voidedAt: null,
        privatePayroll: false,
      },
    });
    if (!row) throw new FinanceError(unavailable);
    await assertOpen(tx, actor.workspace.id, row.occurredOn, row.accountId);
    await assertOpen(tx, actor.workspace.id, row.occurredOn, v.accountId);
    await validateTags(tx, actor.workspace.id, v, row.currency, row.kind);
    if (v.accountId) {
      const a = await tx.financeAccount.findFirstOrThrow({
        where: { id: v.accountId, workspaceId: actor.workspace.id },
      });
      if (row.occurredOn < a.openingOn)
        throw new FinanceError(
          "The entry date is before this account's opening date.",
        );
    }
    const { entryId, ...data } = v;
    await tx.ledgerEntry.updateMany({
      where: { id: entryId, workspaceId: actor.workspace.id },
      data: { ...data, reconciledAt: null },
    });
    await financeNote(tx, actor, "entry", row.id, "tagged");
    return row.id;
  });
}
