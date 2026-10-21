import "server-only";
import { actionError, SAVE_FAILED, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { z } from "zod";
import { assertOpen, lockFinance, FinanceError } from "@/lib/finance/tools/access";
import { parseMoneyToMinor } from "@/lib/format/money";
import { deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import type { ImportRow } from "@/lib/finance/csv";
import { dateOnly } from "@/lib/finance/dates";
import { isNegativeMoney, MAX_AMOUNT_MINOR } from "@/lib/finance/money";
import type { ledgerEntrySchema } from "@/lib/finance/schemas";
import {
  RECEIPT_TYPES,
  RECEIPT_MAX_BYTES,
  NOT_FOUND,
  type Ctx,
  financeActivity,
  checkCategory,
  checkBudget,
  retireUnlinkedFile,
} from "./mutation-helpers";

type LedgerValues = z.output<typeof ledgerEntrySchema>;

// ───────────── Ledger ─────────────

export async function createLedgerEntry(ctx: Ctx, values: LedgerValues, receipt: File | null): Promise<ActionResult<{ id: string }>> {
  const { workspace, user } = ctx;
  const amountMinor = isNegativeMoney(values.amount) ? null : parseMoneyToMinor(values.amount, workspace.currency);
  if (amountMinor === null || amountMinor <= 0) return actionError("Enter a positive amount.", { amount: ["Enter a positive amount."] });
  if (amountMinor > MAX_AMOUNT_MINOR) return actionError("That amount is too large.", { amount: ["That amount is too large."] });
  const categoryError = await checkCategory(prisma, workspace.id, values.categoryId, values.kind);
  if (categoryError) return actionError(categoryError, { categoryId: [categoryError] });
  const budgetError = await checkBudget(prisma, workspace.id, values.budgetId, workspace.currency);
  if (budgetError) return actionError(budgetError, { budgetId: [budgetError] });

  let uploadedKey: string | null = null;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, workspace.id);
        await assertOpen(tx, workspace.id, dateOnly(values.occurredOn));
        let receiptFileId: string | null = null;
        if (receipt) {
          const upload = await uploadWorkspaceFile({ workspaceId: workspace.id, uploadedById: user.id, file: receipt, folder: "/finance/receipts", allowedTypes: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES, client: tx });
          if (!upload.ok) return actionError(upload.error, { receipt: [upload.error] });
          uploadedKey = upload.file.storageKey;
          receiptFileId = upload.file.id;
        }
        const entry = await tx.ledgerEntry.create({
          data: {
            workspaceId: workspace.id,
            kind: values.kind,
            amountMinor,
            currency: workspace.currency,
            occurredOn: dateOnly(values.occurredOn),
            description: values.description,
            counterparty: values.counterparty,
            categoryId: values.categoryId,
            budgetId: values.budgetId,
            receiptFileId,
            createdById: user.id,
          },
        });
        await recordAuditEvent({ action: "finance.entry_created", workspaceId: workspace.id, actorId: user.id, targetType: "ledger_entry", targetId: entry.id, metadata: { kind: entry.kind, amountMinor, currency: entry.currency }, client: tx });
        await financeActivity(tx, ctx, "ledger_entry", entry.id, "created");
        return { ok: true as const, data: { id: entry.id } };
      },
      { timeout: 30_000 },
    );
    if (!result.ok && uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return result;
  } catch (e) {
    if (uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return actionError(e instanceof FinanceError ? e.message : SAVE_FAILED);
  }
}

export async function updateLedgerEntry(
  ctx: Ctx,
  entryId: string,
  values: LedgerValues,
  receipt: { file: File | null; remove: boolean },
): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const existing = await prisma.ledgerEntry.findFirst({ where: { id: entryId, workspaceId: workspace.id } });
  if (!existing) return actionError(NOT_FOUND);
  if (existing.privatePayroll) return actionError("Open this record in the pay register.");
  if (existing.voidedAt) return actionError("Voided entries can't be edited.");
  const linked = Boolean(existing.sourceType);
  // Entries posted from another record keep their money facts; only the bookkeeping fields change.
  const kind = linked ? existing.kind : values.kind;
  let amountMinor = existing.amountMinor;
  if (!linked) {
    const parsed = isNegativeMoney(values.amount) ? null : parseMoneyToMinor(values.amount, existing.currency);
    if (parsed === null || parsed <= 0) return actionError("Enter a positive amount.", { amount: ["Enter a positive amount."] });
    if (parsed > MAX_AMOUNT_MINOR) return actionError("That amount is too large.", { amount: ["That amount is too large."] });
    amountMinor = parsed;
  }
  const categoryError = await checkCategory(prisma, workspace.id, values.categoryId, kind, existing.categoryId);
  if (categoryError) return actionError(categoryError, { categoryId: [categoryError] });
  const budgetError = await checkBudget(prisma, workspace.id, values.budgetId, existing.currency);
  if (budgetError) return actionError(budgetError, { budgetId: [budgetError] });

  let uploadedKey: string | null = null;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, workspace.id);
        await assertOpen(tx, workspace.id, existing.occurredOn, existing.accountId);
        await assertOpen(tx, workspace.id, linked ? existing.occurredOn : dateOnly(values.occurredOn), existing.accountId);
        let receiptFileId = existing.receiptFileId;
        if (receipt.file) {
          const upload = await uploadWorkspaceFile({ workspaceId: workspace.id, uploadedById: user.id, file: receipt.file, folder: "/finance/receipts", allowedTypes: RECEIPT_TYPES, maxBytes: RECEIPT_MAX_BYTES, client: tx });
          if (!upload.ok) return actionError(upload.error, { receipt: [upload.error] });
          uploadedKey = upload.file.storageKey;
          receiptFileId = upload.file.id;
        } else if (receipt.remove) {
          receiptFileId = null;
        }
        const changed = await tx.ledgerEntry.updateMany({
          where: { id: existing.id, workspaceId: workspace.id, voidedAt: null, updatedAt: existing.updatedAt },
          data: {
            ...(linked ? {} : { kind, amountMinor, occurredOn: dateOnly(values.occurredOn) }),
            description: values.description,
            counterparty: values.counterparty,
            categoryId: values.categoryId,
            budgetId: values.budgetId,
            receiptFileId,
          },
        });
        // Roll back an uploaded FileObject too if another edit/void won the race.
        if (changed.count === 0) throw new Error("Entry changed during save");
        if (existing.receiptFileId && existing.receiptFileId !== receiptFileId) await retireUnlinkedFile(tx, workspace.id, existing.receiptFileId);
        await recordAuditEvent({ action: "finance.entry_updated", workspaceId: workspace.id, actorId: user.id, targetType: "ledger_entry", targetId: existing.id, metadata: { amountMinor, linked }, client: tx });
        await financeActivity(tx, ctx, "ledger_entry", existing.id, "updated");
        return { ok: true as const };
      },
      { timeout: 30_000 },
    );
    if (!result.ok && uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return result;
  } catch (e) {
    if (uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return actionError(e instanceof FinanceError ? e.message : SAVE_FAILED);
  }
}

export async function setLedgerEntryVoided(ctx: Ctx, entryId: string, voided: boolean): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const existing = await prisma.ledgerEntry.findFirst({ where: { id: entryId, workspaceId: workspace.id }, select: { id: true, sourceType: true, voidedAt: true } });
  if (!existing) return actionError(NOT_FOUND);
  if (existing.sourceType) return actionError("This entry was posted from another record. Change it there instead.");
  if (Boolean(existing.voidedAt) === voided) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await lockFinance(tx, workspace.id);
    const current = await tx.ledgerEntry.findFirstOrThrow({ where: { id: existing.id, workspaceId: workspace.id } });
    await assertOpen(tx, workspace.id, current.occurredOn, current.accountId);
    await tx.ledgerEntry.updateMany({ where: { id: existing.id, workspaceId: workspace.id }, data: { voidedAt: voided ? new Date() : null } });
    await recordAuditEvent({ action: voided ? "finance.entry_voided" : "finance.entry_restored", workspaceId: workspace.id, actorId: user.id, targetType: "ledger_entry", targetId: existing.id, client: tx });
    await financeActivity(tx, ctx, "ledger_entry", existing.id, voided ? "voided" : "restored");
  });
  return { ok: true };
}

export async function importLedgerRows(ctx: Ctx, rows: ImportRow[]): Promise<ActionResult<{ count: number }>> {
  const { workspace, user } = ctx;
  // Categories were matched on the client preview; re-check they still belong here with the right kind.
  const categoryIds = [...new Set(rows.map((row) => row.categoryId).filter((id): id is string => Boolean(id)))];
  const categories = await prisma.financeCategory.findMany({ where: { workspaceId: workspace.id, id: { in: categoryIds }, archivedAt: null }, select: { id: true, kind: true } });
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));
  if (rows.some((row) => row.categoryId && kindOf.get(row.categoryId) !== row.kind)) return actionError("A category changed since the preview. Check the file again.");
  if (rows.some((row) => row.currency !== workspace.currency)) return actionError(`Every entry must be in ${workspace.currency}. Check the file again.`);
  await prisma.$transaction(async (tx) => {
    await lockFinance(tx, workspace.id);
    for (const month of new Set(rows.map(row => row.occurredOn.slice(0,7)))) await assertOpen(tx, workspace.id, dateOnly(`${month}-01`));
    await tx.ledgerEntry.createMany({
      data: rows.map((row) => ({
        workspaceId: workspace.id,
        kind: row.kind,
        amountMinor: row.amountMinor,
        currency: workspace.currency,
        occurredOn: dateOnly(row.occurredOn),
        description: row.description,
        counterparty: row.counterparty,
        categoryId: row.categoryId,
        createdById: user.id,
      })),
    });
    await recordAuditEvent({ action: "finance.ledger_imported", workspaceId: workspace.id, actorId: user.id, targetType: "ledger", metadata: { count: rows.length }, client: tx });
    await financeActivity(tx, ctx, "ledger", workspace.id, "imported");
  });
  return { ok: true, data: { count: rows.length } };
}

