import "server-only";
import { Prisma } from "@prisma/client";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { nextWorkspaceSequence } from "@/lib/counters";
import { prisma, type DbClient, type Tx } from "@/lib/db";
import { enqueueEmail } from "@/lib/outbox";
import { assertOpen, lockFinance } from "@/lib/finance/tools/access";
import { parseMoneyToMinor } from "@/lib/format/money";
import { dateOnly, localDate } from "@/lib/finance/dates";
import {
  canTransition,
  formatInvoiceNumber,
  INVOICE_SOURCE_TYPE,
  isEditableInvoice,
  type InvoiceStatusValue,
} from "@/lib/finance/invoice";
import {
  invoiceTotals,
  isNegativeMoney,
  lineSubtotalMinor,
  MAX_AMOUNT_MINOR,
  type InvoiceItem,
} from "@/lib/finance/money";
import type { invoiceSchema } from "@/lib/finance/schemas";
import type { z } from "zod";
import {
  INVOICE_NOT_FOUND,
  type Ctx,
  financeActivity,
  checkCategory,
} from "./mutation-helpers";
import { renderInvoiceEmail } from "./invoice-email";

// ───────────── Invoices ─────────────

type InvoiceValues = z.output<typeof invoiceSchema>;

/** Lock before reading money facts, so payments use the last committed edit. */
async function lockedInvoice(tx: Tx, workspaceId: string, invoiceId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  return tx.invoice.findFirst({ where: { id: invoiceId, workspaceId } });
}

async function invoiceChanged(tx: DbClient, ctx: Ctx, invoice: { id: string; number: string; clientName: string; status: string }, verb: string) {
  // Shared search/activity visibility has no finance/admin gate. Never copy
  // client names, invoice numbers or amounts into a workspace-wide index.
  await financeActivity(tx, ctx, "invoice", invoice.id, verb);
}


function toItems(values: InvoiceValues, currency: string): { ok: true; items: InvoiceItem[] } | { ok: false; error: string; field: string } {
  const items: InvoiceItem[] = [];
  for (const [index, item] of values.items.entries()) {
    const unitMinor = isNegativeMoney(item.unitPrice) ? null : parseMoneyToMinor(item.unitPrice, currency);
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
    await invoiceChanged(tx, ctx, created, "created");
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
    const updated = await tx.invoice.findFirstOrThrow({ where: { id: existing.id, workspaceId: workspace.id } });
    await invoiceChanged(tx, ctx, updated, "updated");
    return { ok: true as const };
  });
}

/** Mark sent (DRAFT → SENT) and optionally email the client. Re-sending a SENT invoice only emails again. */
export async function sendInvoice(ctx: Ctx, invoiceId: string, options: { email: boolean }): Promise<ActionResult<{ emailed: boolean }>> {
  const { workspace, user } = ctx;
  return prisma.$transaction(async (tx) => {
    const invoice = await lockedInvoice(tx, workspace.id, invoiceId);
    if (!invoice) return actionError(INVOICE_NOT_FOUND);
    if (invoice.status !== "DRAFT" && invoice.status !== "SENT") return actionError("Only draft or sent invoices can be sent.");
    if (options.email && !invoice.clientEmail) return actionError("Add the client's email address first.");
    if (invoice.status === "DRAFT") {
      const changed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: workspace.id, status: "DRAFT" }, data: { status: "SENT" } });
      if (changed.count === 0) return actionError("That invoice changed. Refresh and try again.");
    }
    if (options.email && invoice.clientEmail) {
      await enqueueEmail(tx, { workspaceId: workspace.id, to: invoice.clientEmail, ...renderInvoiceEmail({ ...invoice, workspaceName: workspace.name, timeZone: workspace.timezone }) });
    }
    await recordAuditEvent({ action: "finance.invoice_sent", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: invoice.id, metadata: { emailed: options.email }, client: tx });
    await invoiceChanged(tx, ctx, { ...invoice, status: "SENT" }, "sent");
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
  const categoryId = options.categoryId ?? null;
  const categoryError = await checkCategory(prisma, workspace.id, categoryId, "INCOME");
  if (categoryError) return actionError(categoryError, { categoryId: [categoryError] });
  const paidOn = options.paidOn ?? localDate(new Date(), workspace.timezone);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, workspace.id);
    await assertOpen(tx, workspace.id, dateOnly(paidOn));
    const invoice = await lockedInvoice(tx, workspace.id, invoiceId);
    if (!invoice) return actionError(INVOICE_NOT_FOUND);
    if (invoice.status === "PAID") return { ok: true as const };
    if (!canTransition(invoice.status, "PAID")) return actionError(invoice.status === "DRAFT" ? "Send the invoice before marking it paid." : "Void invoices can't be paid.");
    const claimed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: workspace.id, status: "SENT" }, data: { status: "PAID", paidAt: dateOnly(paidOn) } });
    if (claimed.count === 0) {
      const current = await tx.invoice.findFirst({ where: { id: invoice.id, workspaceId: workspace.id }, select: { status: true } });
      if (current?.status !== "PAID") return actionError("That invoice changed. Refresh and try again.");
    }
    await postInvoiceIncome(tx, { ...invoice, workspaceId: workspace.id }, { paidOn, categoryId, actorId: user.id });
    if (claimed.count > 0) {
      await invoiceChanged(tx, ctx, { ...invoice, status: "PAID" }, "paid");
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
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: workspace.id }, select: { id: true, status: true, number: true, clientName: true } });
  if (!invoice) return actionError(INVOICE_NOT_FOUND);
  if (invoice.status === "VOID") return { ok: true };
  const from = invoice.status as InvoiceStatusValue;
  if (!canTransition(from, "VOID")) return actionError("That invoice can't be voided.");
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, workspace.id);
    const entry = await tx.ledgerEntry.findFirst({ where: { workspaceId: workspace.id, sourceType: INVOICE_SOURCE_TYPE, sourceId: invoice.id } });
    if (entry) await assertOpen(tx, workspace.id, entry.occurredOn, entry.accountId);
    const changed = await tx.invoice.updateMany({ where: { id: invoice.id, workspaceId: workspace.id, status: from }, data: { status: "VOID" } });
    if (changed.count === 0) return actionError("That invoice changed. Refresh and try again.");
    await invoiceChanged(tx, ctx, { ...invoice, status: "VOID" }, "voided");
    // A paid invoice's income leaves the kitty with it.
    await tx.ledgerEntry.updateMany({ where: { workspaceId: workspace.id, sourceType: INVOICE_SOURCE_TYPE, sourceId: invoice.id, voidedAt: null }, data: { voidedAt: new Date() } });
    await recordAuditEvent({ action: "finance.invoice_voided", workspaceId: workspace.id, actorId: user.id, targetType: "invoice", targetId: invoice.id, metadata: { from }, client: tx });
    return { ok: true as const };
  });
}

export async function deleteDraftInvoice(ctx: Ctx, invoiceId: string): Promise<ActionResult> {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.invoice.deleteMany({ where: { id: invoiceId, workspaceId: ctx.workspace.id, status: "DRAFT" } });
    if (deleted.count === 0) return actionError("Only draft invoices can be deleted. Void it instead.");
    await recordAuditEvent({ action: "finance.invoice_deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "invoice", targetId: invoiceId, client: tx });
    return { ok: true as const };
  });
}

