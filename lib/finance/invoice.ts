/**
 * Invoice rules (pure, client-safe): numbering, status flow, overdue.
 *
 * DRAFT → SENT → PAID, and DRAFT or SENT → VOID. A PAID invoice can still be
 * voided; that also voids the ledger entry it posted. Only DRAFT and SENT
 * invoices can be edited.
 */

export type InvoiceStatusValue = "DRAFT" | "SENT" | "PAID" | "VOID";

export const INVOICE_STATUSES: readonly InvoiceStatusValue[] = ["DRAFT", "SENT", "PAID", "VOID"];

export const INVOICE_STATUS_LABEL: Record<InvoiceStatusValue, string> = { DRAFT: "Draft", SENT: "Sent", PAID: "Paid", VOID: "Void" };

const TRANSITIONS: Record<InvoiceStatusValue, readonly InvoiceStatusValue[]> = {
  DRAFT: ["SENT", "VOID"],
  SENT: ["PAID", "VOID"],
  PAID: ["VOID"],
  VOID: [],
};

export function canTransition(from: InvoiceStatusValue, to: InvoiceStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isEditableInvoice(status: InvoiceStatusValue): boolean {
  return status === "DRAFT" || status === "SENT";
}

/** "INV-0007" from the workspace "invoice" counter. */
export function formatInvoiceNumber(sequence: number): string {
  return `INV-${String(sequence).padStart(4, "0")}`;
}

/** The ledger link an invoice payment posts under (unique per source, so retries are safe). */
export const INVOICE_SOURCE_TYPE = "invoice";

/** `today` is the workspace's local date as YYYY-MM-DD; `dueOn` a date-only value. */
export function isInvoiceOverdue(invoice: { status: InvoiceStatusValue; dueOn: Date | null }, today: string): boolean {
  if (invoice.status !== "SENT" || !invoice.dueOn) return false;
  return invoice.dueOn.toISOString().slice(0, 10) < today;
}
