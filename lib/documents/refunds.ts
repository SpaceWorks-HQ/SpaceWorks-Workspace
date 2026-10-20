import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { DocumentsError } from "./access";
export type RefundAllocation = {
  invoiceId: string;
  number: string;
  cashMinor: number;
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export async function refundState(workspaceId: string, tx: DbClient = prisma) {
  const rows = await tx.businessDocument.findMany({
    where: {
      workspaceId,
      status: "ISSUED",
      type: { in: ["PAYMENT_REFUND", "REFUND_VOUCHER"] },
    },
    select: { parentId: true, totalMinor: true, snapshot: true },
    take: 10001,
  });
  if (rows.length > 10000)
    throw new DocumentsError(
      "Narrow the refund register before calculating balances.",
    );
  const invoices = new Map<string, number>(),
    receipts = new Map<
      string,
      { total: number; allocated: number; invoices: Map<string, number> }
    >();
  for (const row of rows) {
    if (!row.parentId) continue;
    const receipt = receipts.get(row.parentId) ?? {
      total: 0,
      allocated: 0,
      invoices: new Map<string, number>(),
    };
    receipt.total += row.totalMinor;
    const allocations = object(object(row.snapshot).source).refundAllocations;
    if (Array.isArray(allocations))
      for (const item of allocations) {
        const allocation = object(item),
          id = String(allocation.invoiceId),
          amount = Number(allocation.cashMinor);
        if (!Number.isSafeInteger(amount) || amount <= 0)
          throw new DocumentsError(
            "Review the retained refund allocation facts.",
          );
        invoices.set(id, (invoices.get(id) ?? 0) + amount);
        receipt.invoices.set(id, (receipt.invoices.get(id) ?? 0) + amount);
        receipt.allocated += amount;
      }
    receipts.set(row.parentId, receipt);
  }
  return { invoices, receipts };
}
/** Freeze the cash portions being returned; withholding is never refunded as cash. */
export async function planRefund(
  workspaceId: string,
  receiptId: string,
  cashReceived: number,
  amount: number,
  tx: DbClient,
) {
  const state = await refundState(workspaceId, tx),
    prior = state.receipts.get(receiptId),
    total = prior?.total ?? 0;
  if (amount <= 0 || amount > cashReceived - total)
    throw new DocumentsError("This refund exceeds the original cash received.");
  const allocations = await tx.documentAllocation.findMany({
    where: { workspaceId, receiptId },
    include: { invoice: { select: { number: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 10001,
  });
  if (allocations.length > 10000)
    throw new DocumentsError(
      "Review this receipt's allocation register before refunding.",
    );
  const paid = allocations.reduce((sum, a) => sum + a.cashMinor, 0);
  let remaining = Math.max(
    0,
    amount -
      Math.max(0, cashReceived - paid - (total - (prior?.allocated ?? 0))),
  );
  const grouped = new Map<string, RefundAllocation>();
  for (const allocation of allocations) {
    const entry = grouped.get(allocation.invoiceId) ?? {
      invoiceId: allocation.invoiceId,
      number: allocation.invoice.number ?? "",
      cashMinor: 0,
    };
    entry.cashMinor += allocation.cashMinor;
    grouped.set(entry.invoiceId, entry);
  }
  const result: RefundAllocation[] = [];
  for (const entry of grouped.values()) {
    const reversed = Math.min(
      remaining,
      entry.cashMinor - (prior?.invoices.get(entry.invoiceId) ?? 0),
    );
    if (reversed > 0) {
      result.push({ ...entry, cashMinor: reversed });
      remaining -= reversed;
    }
  }
  if (remaining)
    throw new DocumentsError("The refund exceeds available cash allocations.");
  return result;
}
