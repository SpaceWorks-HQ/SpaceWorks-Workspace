import "server-only";
import { prisma } from "@/lib/db";
import { assertOpen, lockFinance } from "@/lib/finance/tools/access";
import {
  DocumentsError,
  getDocument,
  lockDocuments,
  type DocumentsActor,
} from "../access";
import { creditsByInvoice } from "../corrections";
import { refundState } from "../refunds";
import { ALLOCATABLE_RECEIPTS, draftSchema, INVOICES } from "../rules";
import { audit, date } from "./shared";

export async function allocatePayment(actor: DocumentsActor, raw: unknown) {
  const { z } = await import("zod");
  const v = z
    .object({
      receiptId: z.string().min(1).max(64),
      invoiceId: z.string().min(1).max(64),
      cashMinor: z.number().int().min(0).max(2147483647),
      tdsMinor: z.number().int().min(0).max(2147483647),
      key: z.string().uuid(),
    })
    .parse(raw);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await lockDocuments(tx, actor.workspace.id);
    const receipt = await getDocument(actor, v.receiptId, tx),
      invoice = await getDocument(actor, v.invoiceId, tx);
    const prior = await tx.documentAllocation.findUnique({
      where: {
        workspaceId_key: { workspaceId: actor.workspace.id, key: v.key },
      },
    });
    if (prior) {
      if (
        prior.receiptId !== v.receiptId ||
        prior.invoiceId !== v.invoiceId ||
        prior.cashMinor !== v.cashMinor ||
        prior.tdsMinor !== v.tdsMinor
      )
        throw new DocumentsError(
          "This retry belongs to a different allocation.",
        );
      return prior.id;
    }
    if (
      receipt.status !== "ISSUED" ||
      invoice.status !== "ISSUED" ||
      !ALLOCATABLE_RECEIPTS.includes(receipt.type) ||
      !INVOICES.includes(invoice.type) ||
      receipt.currency !== invoice.currency ||
      v.cashMinor + v.tdsMinor === 0
    )
      throw new DocumentsError(
        "Choose an issued receipt and invoice in the same currency.",
      );
    const receiptParty = draftSchema.parse(receipt.input),
      invoiceParty = draftSchema.parse(invoice.input);
    if (
      (receiptParty.contactId &&
        receiptParty.contactId !== invoiceParty.contactId) ||
      (receiptParty.organisationId &&
        receiptParty.organisationId !== invoiceParty.organisationId) ||
      (receiptParty.partyTaxId &&
        receiptParty.partyTaxId !== invoiceParty.partyTaxId) ||
      receiptParty.partyName !== invoiceParty.partyName
    )
      throw new DocumentsError(
        "Allocate a receipt to an invoice for the same recipient.",
      );
    const input = draftSchema.parse(receipt.input),
      r = await tx.documentAllocation.aggregate({
        where: { workspaceId: actor.workspace.id, receiptId: receipt.id },
        _sum: { cashMinor: true, tdsMinor: true },
      }),
      i = await tx.documentAllocation.aggregate({
        where: { workspaceId: actor.workspace.id, invoiceId: invoice.id },
        _sum: { cashMinor: true, tdsMinor: true },
      });
    const credited =
      (await creditsByInvoice(actor.workspace.id, tx)).get(invoice.id) ?? 0;
    const refunds = await refundState(actor.workspace.id, tx),
      returned = refunds.receipts.get(receipt.id);

    if (
      (r._sum.cashMinor ?? 0) - (returned?.allocated ?? 0) + v.cashMinor >
        input.cashMinor - (returned?.total ?? 0) ||
      (r._sum.tdsMinor ?? 0) + v.tdsMinor > input.tdsMinor ||
      (i._sum.cashMinor ?? 0) -
        (refunds.invoices.get(invoice.id) ?? 0) +
        (i._sum.tdsMinor ?? 0) +
        v.cashMinor +
        v.tdsMinor >
        invoice.totalMinor - credited
    )
      throw new DocumentsError(
        "The allocation exceeds the receipt or invoice balance.",
      );
    await assertOpen(
      tx,
      actor.workspace.id,
      date(input.paymentOn || input.issuedOn),
    );
    const row = await tx.documentAllocation.create({
      data: {
        ...v,
        workspaceId: actor.workspace.id,
        createdById: actor.user.id,
      },
    });
    await audit(actor, "payment_allocated", invoice.id, tx);
    return row.id;
  });
}
