/** Display words for linked ledger entries and invoice statuses (client-safe). */

import type { ChipTone } from "@/components/ui/display";
import type { InvoiceStatusValue } from "@/lib/finance/invoice";

const SOURCE_LABELS: Record<string, string> = {
  invoice: "Posted from an invoice",
  reimbursement: "Posted from a reimbursement",
  purchase_request: "Posted from a purchase request",
};

export function sourceLabel(sourceType: string | null): string | null {
  if (!sourceType) return null;
  return SOURCE_LABELS[sourceType] ?? "Posted from another record";
}

/** Where a linked entry's source lives, when this workspace has a page for it. */
export function sourceHref(base: string, sourceType: string | null, sourceId: string | null): string | null {
  if (!sourceType || !sourceId) return null;
  if (sourceType === "invoice") return `${base}/finance/invoices/${sourceId}`;
  if (sourceType === "reimbursement" || sourceType === "purchase_request") return `${base}/requests`;
  return null;
}

export const INVOICE_STATUS_TONE: Record<InvoiceStatusValue, ChipTone> = { DRAFT: "neutral", SENT: "info", PAID: "success", VOID: "outline" };
