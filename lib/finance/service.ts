import "server-only";

import { Prisma, type LedgerKind } from "@prisma/client";
import { actionError, SAVE_FAILED, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { nextWorkspaceSequence } from "@/lib/counters";
import { prisma, type DbClient, type Tx } from "@/lib/db";
import { escapeHtml, renderNotificationEmail } from "@/lib/email/templates";
import { formatMoney, parseMoneyToMinor } from "@/lib/format/money";
import { enqueueEmail } from "@/lib/outbox";
import type { WorkspaceContext } from "@/lib/permissions";
import { RASTER_IMAGE_TYPES, deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import { type ImportRow } from "@/lib/finance/csv";
import { dateOnly, localDate } from "@/lib/finance/dates";
import { canTransition, formatInvoiceNumber, INVOICE_SOURCE_TYPE, isEditableInvoice, type InvoiceStatusValue } from "@/lib/finance/invoice";
import { invoiceTotals, lineSubtotalMinor, MAX_AMOUNT_MINOR, type InvoiceItem } from "@/lib/finance/money";
import type { categorySchema, invoiceSchema, ledgerEntrySchema } from "@/lib/finance/schemas";
import type { z } from "zod";

/**
 * Finance mutations. Callers (Server Actions) have already resolved the
 * workspace from the slug and checked `canManageFinance`; every query here
 * still filters by `workspaceId` so an id from another workspace never
 * resolves.
 */

export const RECEIPT_TYPES: ReadonlySet<string> = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const NOT_FOUND = "That entry isn't available any more. Refresh and try again.";
const INVOICE_NOT_FOUND = "That invoice isn't available any more. Refresh and try again.";

type Ctx = Pick<WorkspaceContext, "user" | "workspace">;
type LedgerValues = z.output<typeof ledgerEntrySchema>;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function checkCategory(client: DbClient, workspaceId: string, categoryId: string | null, kind: LedgerKind): Promise<string | null> {
  if (!categoryId) return null;
  const category = await client.financeCategory.findFirst({ where: { id: categoryId, workspaceId }, select: { kind: true, archivedAt: true } });
  if (!category) return "Choose a category from the list.";
  if (category.kind !== kind) return kind === "INCOME" ? "Choose an income category." : "Choose an expense category.";
  return null;
}

async function checkBudget(client: DbClient, workspaceId: string, budgetId: string | null): Promise<string | null> {
  if (!budgetId) return null;
  const budget = await client.budget.findFirst({ where: { id: budgetId, workspaceId }, select: { id: true } });
  return budget ? null : "Choose a budget from the list.";
}

/** Soft-delete receipt/cover files we uploaded once nothing links to them, so they never surface in the files library. */
export async function retireUnlinkedFile(client: DbClient, workspaceId: string, fileId: string | null) {
  if (!fileId) return;
  await client.fileObject.updateMany({
    where: { id: fileId, workspaceId, deletedAt: null, ledgerReceipts: { none: {} }, blogCovers: { none: {} }, messageAttachments: { none: {} }, docId: null, taskId: null },
    data: { deletedAt: new Date() },
  });
}

// ───────────── Ledger ─────────────

export async function createLedgerEntry(ctx: Ctx, values: LedgerValues, receipt: File | null): Promise<ActionResult<{ id: string }>> {
  const { workspace, user } = ctx;
  const amountMinor = parseMoneyToMinor(values.amount, workspace.currency);
  if (amountMinor === null || amountMinor <= 0) return actionError("Enter a positive amount.", { amount: ["Enter a positive amount."] });
  if (amountMinor > MAX_AMOUNT_MINOR) return actionError("That amount is too large.", { amount: ["That amount is too large."] });
  const categoryError = await checkCategory(prisma, workspace.id, values.categoryId, values.kind);
  if (categoryError) return actionError(categoryError, { categoryId: [categoryError] });
  const budgetError = await checkBudget(prisma, workspace.id, values.budgetId);
  if (budgetError) return actionError(budgetError, { budgetId: [budgetError] });

  let uploadedKey: string | null = null;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
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
        return { ok: true as const, data: { id: entry.id } };
      },
      { timeout: 30_000 },
    );
    if (!result.ok && uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return result;
  } catch {
    if (uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return actionError(SAVE_FAILED);
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
  if (existing.voidedAt) return actionError("Voided entries can't be edited.");
  const linked = Boolean(existing.sourceType);
  // Entries posted from another record keep their money facts; only the bookkeeping fields change.
  const kind = linked ? existing.kind : values.kind;
  let amountMinor = existing.amountMinor;
  if (!linked) {
    const parsed = parseMoneyToMinor(values.amount, existing.currency);
    if (parsed === null || parsed <= 0) return actionError("Enter a positive amount.", { amount: ["Enter a positive amount."] });
    if (parsed > MAX_AMOUNT_MINOR) return actionError("That amount is too large.", { amount: ["That amount is too large."] });
    amountMinor = parsed;
  }
  const categoryError = await checkCategory(prisma, workspace.id, values.categoryId, kind);
  if (categoryError) return actionError(categoryError, { categoryId: [categoryError] });
  const budgetError = await checkBudget(prisma, workspace.id, values.budgetId);
  if (budgetError) return actionError(budgetError, { budgetId: [budgetError] });

  let uploadedKey: string | null = null;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
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
          where: { id: existing.id, workspaceId: workspace.id, voidedAt: null },
          data: {
            ...(linked ? {} : { kind, amountMinor, occurredOn: dateOnly(values.occurredOn) }),
            description: values.description,
            counterparty: values.counterparty,
            categoryId: values.categoryId,
            budgetId: values.budgetId,
            receiptFileId,
          },
        });
        if (changed.count === 0) return actionError(NOT_FOUND);
        if (existing.receiptFileId && existing.receiptFileId !== receiptFileId) await retireUnlinkedFile(tx, workspace.id, existing.receiptFileId);
        await recordAuditEvent({ action: "finance.entry_updated", workspaceId: workspace.id, actorId: user.id, targetType: "ledger_entry", targetId: existing.id, metadata: { amountMinor, linked }, client: tx });
        return { ok: true as const };
      },
      { timeout: 30_000 },
    );
    if (!result.ok && uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return result;
  } catch {
    if (uploadedKey) await deleteObjects([uploadedKey]).catch(() => undefined);
    return actionError(SAVE_FAILED);
  }
}

export async function setLedgerEntryVoided(ctx: Ctx, entryId: string, voided: boolean): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const existing = await prisma.ledgerEntry.findFirst({ where: { id: entryId, workspaceId: workspace.id }, select: { id: true, sourceType: true, voidedAt: true } });
  if (!existing) return actionError(NOT_FOUND);
  if (existing.sourceType) return actionError("This entry was posted from another record. Change it there instead.");
  if (Boolean(existing.voidedAt) === voided) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.updateMany({ where: { id: existing.id, workspaceId: workspace.id }, data: { voidedAt: voided ? new Date() : null } });
    await recordAuditEvent({ action: voided ? "finance.entry_voided" : "finance.entry_restored", workspaceId: workspace.id, actorId: user.id, targetType: "ledger_entry", targetId: existing.id, client: tx });
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
  });
  return { ok: true, data: { count: rows.length } };
}

// ───────────── Categories ─────────────

export async function createCategory(ctx: Ctx, values: z.output<typeof categorySchema>): Promise<ActionResult<{ id: string }>> {
  try {
    const category = await prisma.financeCategory.create({ data: { workspaceId: ctx.workspace.id, name: values.name, kind: values.kind } });
    await recordAuditEvent({ action: "finance.category_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "finance_category", targetId: category.id });
    return { ok: true, data: { id: category.id } };
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("A category with that name already exists.", { name: ["A category with that name already exists."] });
    return actionError(SAVE_FAILED);
  }
}

export async function renameCategory(ctx: Ctx, categoryId: string, name: string): Promise<ActionResult> {
  try {
    const changed = await prisma.financeCategory.updateMany({ where: { id: categoryId, workspaceId: ctx.workspace.id }, data: { name } });
    if (changed.count === 0) return actionError("That category isn't available any more.");
    await recordAuditEvent({ action: "finance.category_renamed", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "finance_category", targetId: categoryId });
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return actionError("A category with that name already exists.", { name: ["A category with that name already exists."] });
    return actionError(SAVE_FAILED);
  }
}

export async function setCategoryArchived(ctx: Ctx, categoryId: string, archived: boolean): Promise<ActionResult> {
  const changed = await prisma.financeCategory.updateMany({ where: { id: categoryId, workspaceId: ctx.workspace.id }, data: { archivedAt: archived ? new Date() : null } });
  if (changed.count === 0) return actionError("That category isn't available any more.");
  await recordAuditEvent({ action: archived ? "finance.category_archived" : "finance.category_restored", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "finance_category", targetId: categoryId });
  return { ok: true };
}

// ───────────── Invoices ─────────────

type InvoiceValues = z.output<typeof invoiceSchema>;

function toItems(values: InvoiceValues, currency: string): { ok: true; items: InvoiceItem[] } | { ok: false; error: string; field: string } {
  const items: InvoiceItem[] = [];
  for (const [index, item] of values.items.entries()) {
    const unitMinor = parseMoneyToMinor(item.unitPrice, currency);
    if (unitMinor === null) return { ok: false, error: `Line ${index + 1}: enter a valid unit price.`, field: `items.${index}.unitPrice` };
    if (unitMinor > MAX_AMOUNT_MINOR) return { ok: false, error: `Line ${index + 1}: that price is too large.`, field: `items.${index}.unitPrice` };
    items.push({ description: item.description, quantity: Math.round(item.quantity * 100) / 100, unitMinor, ...(item.taxBps ? { taxBps: item.taxBps } : {}) });
  }
  const totals = invoiceTotals(items);
  if (items.some((item) => lineSubtotalMinor(item) > MAX_AMOUNT_MINOR) || totals.totalMinor > MAX_AMOUNT_MINOR) return { ok: false, error: "That invoice total is too large.", field: "items" };
  return { ok: true, items };
}

export async function createInvoice(ctx: Ctx, values: InvoiceValues): Promise<ActionResult<{ id: string; number: string }>> {
  const { workspace, user } = ctx;
  const parsed = toItems(values, workspace.currency);
  if (!parsed.ok) return actionError(parsed.error, { [parsed.field]: [parsed.error] });
  const totals = invoiceTotals(parsed.items);
  const invoice = await prisma.$transaction(async (tx) => {
    const number = formatInvoiceNumber(await nextWorkspaceSequence(tx, workspace.id, "invoice"));
    const created = await tx.invoice.create({
      data: {
        workspaceId: workspace.id,
        number,
        clientName: values.clientName,
        clientEmail: values.clientEmail,
        issuedOn: dateOnly(values.issuedOn),
        dueOn: values.dueOn ? dateOnly(values.dueOn) : null,
        currency: workspace.currency,
        items: parsed.items as unknown as Prisma.InputJsonValue,
        totalMinor: totals.totalMinor,
        notes: values.notes,
        createdById: user.id,
      },
    });
    await recordAuditEvent({ action: "finance.invoice_created", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: created.id, metadata: { number, totalMinor: totals.totalMinor }, client: tx });
    return created;
  });
  return { ok: true, data: { id: invoice.id, number: invoice.number } };
}

export async function updateInvoice(ctx: Ctx, invoiceId: string, values: InvoiceValues): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const existing = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: workspace.id }, select: { id: true, status: true, currency: true } });
  if (!existing) return actionError(INVOICE_NOT_FOUND);
  if (!isEditableInvoice(existing.status)) return actionError("Paid and void invoices can't be edited.");
  const parsed = toItems(values, existing.currency);
  if (!parsed.ok) return actionError(parsed.error, { [parsed.field]: [parsed.error] });
  const totals = invoiceTotals(parsed.items);
  return prisma.$transaction(async (tx) => {
    const changed = await tx.invoice.updateMany({
      where: { id: existing.id, workspaceId: workspace.id, status: { in: ["DRAFT", "SENT"] } },
      data: {
        clientName: values.clientName,
        clientEmail: values.clientEmail,
        issuedOn: dateOnly(values.issuedOn),
        dueOn: values.dueOn ? dateOnly(values.dueOn) : null,
        items: parsed.items as unknown as Prisma.InputJsonValue,
        totalMinor: totals.totalMinor,
        notes: values.notes,
      },
    });
    if (changed.count === 0) return actionError("Paid and void invoices can't be edited.");
    await recordAuditEvent({ action: "finance.invoice_updated", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: existing.id, metadata: { totalMinor: totals.totalMinor }, client: tx });
    return { ok: true as const };
  });
}

/** Mark sent (DRAFT → SENT) and optionally email the client. Re-sending a SENT invoice only emails again. */
export async function sendInvoice(ctx: Ctx, invoiceId: string, options: { email: boolean }): Promise<ActionResult<{ emailed: boolean }>> {
  const { workspace, user } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: workspace.id } });
  if (!invoice) return actionError(INVOICE_NOT_FOUND);
  if (invoice.status !== "DRAFT" && invoice.status !== "SENT") return actionError("Only draft or sent invoices can be sent.");
  if (options.email && !invoice.clientEmail) return actionError("Add the client's email address first.");
  return prisma.$transaction(async (tx) => {
    if (invoice.status === "DRAFT") {
      const changed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: workspace.id, status: "DRAFT" }, data: { status: "SENT" } });
      if (changed.count === 0) return actionError("That invoice changed. Refresh and try again.");
    }
    if (options.email && invoice.clientEmail) {
      await enqueueEmail(tx, { to: invoice.clientEmail, ...renderInvoiceEmail({ ...invoice, workspaceName: workspace.name, timeZone: workspace.timezone }) });
    }
    await recordAuditEvent({ action: "finance.invoice_sent", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: invoice.id, metadata: { emailed: options.email }, client: tx });
    return { ok: true as const, data: { emailed: options.email } };
  });
}

/**
 * SENT → PAID and post one INCOME ledger entry linked by
 * (sourceType "invoice", sourceId). Idempotent: repeating it, or two people
 * clicking at once, leaves exactly one entry.
 */
export async function markInvoicePaid(ctx: Ctx, invoiceId: string, options: { paidOn?: string | null; categoryId?: string | null } = {}): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: workspace.id } });
  if (!invoice) return actionError(INVOICE_NOT_FOUND);
  if (invoice.status !== "PAID" && !canTransition(invoice.status, "PAID")) {
    return actionError(invoice.status === "DRAFT" ? "Send the invoice before marking it paid." : "Void invoices can't be paid.");
  }
  const categoryId = options.categoryId ?? null;
  const categoryError = await checkCategory(prisma, workspace.id, categoryId, "INCOME");
  if (categoryError) return actionError(categoryError, { categoryId: [categoryError] });
  const paidOn = options.paidOn ?? localDate(new Date(), workspace.timezone);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: workspace.id, status: "SENT" }, data: { status: "PAID", paidAt: dateOnly(paidOn) } });
    if (claimed.count === 0) {
      const current = await tx.invoice.findFirst({ where: { id: invoice.id, workspaceId: workspace.id }, select: { status: true } });
      if (current?.status !== "PAID") return actionError("That invoice changed. Refresh and try again.");
    }
    await postInvoiceIncome(tx, { ...invoice, workspaceId: workspace.id }, { paidOn, categoryId, actorId: user.id });
    if (claimed.count > 0) {
      await recordAuditEvent({ action: "finance.invoice_paid", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: invoice.id, metadata: { totalMinor: invoice.totalMinor }, client: tx });
    }
    return { ok: true as const };
  });
}

async function postInvoiceIncome(
  tx: Tx,
  invoice: { id: string; workspaceId: string; number: string; clientName: string; totalMinor: number; currency: string },
  options: { paidOn: string; categoryId: string | null; actorId: string },
) {
  await tx.ledgerEntry.createMany({
    data: [
      {
        workspaceId: invoice.workspaceId,
        kind: "INCOME",
        amountMinor: invoice.totalMinor,
        currency: invoice.currency,
        occurredOn: dateOnly(options.paidOn),
        description: `Invoice ${invoice.number}`,
        counterparty: invoice.clientName,
        categoryId: options.categoryId,
        createdById: options.actorId,
        sourceType: INVOICE_SOURCE_TYPE,
        sourceId: invoice.id,
      },
    ],
    skipDuplicates: true,
  });
}

export async function voidInvoice(ctx: Ctx, invoiceId: string): Promise<ActionResult> {
  const { workspace, user } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: workspace.id }, select: { id: true, status: true } });
  if (!invoice) return actionError(INVOICE_NOT_FOUND);
  if (invoice.status === "VOID") return { ok: true };
  const from = invoice.status as InvoiceStatusValue;
  if (!canTransition(from, "VOID")) return actionError("That invoice can't be voided.");
  return prisma.$transaction(async (tx) => {
    const changed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: workspace.id, status: from }, data: { status: "VOID" } });
    if (changed.count === 0) return actionError("That invoice changed. Refresh and try again.");
    // A paid invoice's income leaves the kitty with it.
    await tx.ledgerEntry.updateMany({ where: { workspaceId: workspace.id, sourceType: INVOICE_SOURCE_TYPE, sourceId: invoice.id, voidedAt: null }, data: { voidedAt: new Date() } });
    await recordAuditEvent({ action: "finance.invoice_voided", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: invoice.id, metadata: { from }, client: tx });
    return { ok: true as const };
  });
}

export async function deleteDraftInvoice(ctx: Ctx, invoiceId: string): Promise<ActionResult> {
  const deleted = await prisma.invoice.deleteMany({ where: { id: invoiceId, workspaceId: ctx.workspace.id, status: "DRAFT" } });
  if (deleted.count === 0) return actionError("Only draft invoices can be deleted. Void it instead.");
  await recordAuditEvent({ action: "finance.invoice_deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "invoice", targetId: invoiceId });
  return { ok: true };
}

// ───────────── Invoice email ─────────────

export function renderInvoiceEmail(invoice: {
  number: string;
  clientName: string;
  issuedOn: Date;
  dueOn: Date | null;
  currency: string;
  items: Prisma.JsonValue;
  totalMinor: number;
  notes: string | null;
  workspaceName: string;
  timeZone: string;
}) {
  const items = parseInvoiceItems(invoice.items);
  const totals = invoiceTotals(items);
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const day = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const rows = items
    .map((item) => `<tr><td style="padding:6px 0">${escapeHtml(item.description)}</td><td style="padding:6px 8px;text-align:right">${item.quantity}</td><td style="padding:6px 0;text-align:right">${escapeHtml(money(lineSubtotalMinor(item)))}</td></tr>`)
    .join("");
  const bodyHtml = [
    `<p>Hello ${escapeHtml(invoice.clientName)},</p>`,
    `<p>Here is invoice <strong>${escapeHtml(invoice.number)}</strong> from ${escapeHtml(invoice.workspaceName)}, issued ${escapeHtml(day(invoice.issuedOn))}${invoice.dueOn ? `, due ${escapeHtml(day(invoice.dueOn))}` : ""}.</p>`,
    `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Item</th><th style="text-align:right;padding:0 8px">Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`,
    totals.taxMinor ? `<p>Subtotal ${escapeHtml(money(totals.subtotalMinor))} · Tax ${escapeHtml(money(totals.taxMinor))}</p>` : "",
    `<p><strong>Total due: ${escapeHtml(money(totals.totalMinor))}</strong></p>`,
    invoice.notes ? `<p>${escapeHtml(invoice.notes).replace(/\n/g, "<br>")}</p>` : "",
  ].join("");
  const subject = `Invoice ${invoice.number} from ${invoice.workspaceName}`;
  const rendered = renderNotificationEmail({ title: subject, bodyHtml });
  const text = [
    `Hello ${invoice.clientName},`,
    "",
    `Here is invoice ${invoice.number} from ${invoice.workspaceName}, issued ${day(invoice.issuedOn)}${invoice.dueOn ? `, due ${day(invoice.dueOn)}` : ""}.`,
    "",
    ...items.map((item) => `- ${item.description} × ${item.quantity}: ${money(lineSubtotalMinor(item))}`),
    "",
    ...(totals.taxMinor ? [`Subtotal ${money(totals.subtotalMinor)} · Tax ${money(totals.taxMinor)}`] : []),
    `Total due: ${money(totals.totalMinor)}`,
    ...(invoice.notes ? ["", invoice.notes] : []),
  ].join("\n");
  return { subject, html: rendered.html, text };
}

/** Stored JSON → typed items, dropping anything malformed. */
export function parseInvoiceItems(value: Prisma.JsonValue): InvoiceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.description !== "string" || typeof item.quantity !== "number" || typeof item.unitMinor !== "number") return [];
    return [{ description: item.description, quantity: item.quantity, unitMinor: item.unitMinor, ...(typeof item.taxBps === "number" && item.taxBps > 0 ? { taxBps: item.taxBps } : {}) }];
  });
}
