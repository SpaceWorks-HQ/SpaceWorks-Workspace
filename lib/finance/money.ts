/**
 * Pure money math for the kitty (client-safe). Every amount is an integer in
 * minor units; nothing here ever touches a float amount except the quantity
 * of an invoice line, which is held in hundredths and rounded once per line.
 */

import { currencyMinorDigits } from "@/lib/format/money";

export type LedgerKindValue = "INCOME" | "EXPENSE";

/** The schema stores each amount in a PostgreSQL signed 32-bit integer. */
export const MAX_AMOUNT_MINOR = 2_147_483_647;

/** The shared display parser accepts currency prefixes; finance also rejects negative input. */
export function isNegativeMoney(input: string): boolean {
  return /[-−(]/.test(input);
}

/** +amount for income, −amount for expenses. */
export function signedAmount(kind: LedgerKindValue, amountMinor: number): number {
  return kind === "INCOME" ? amountMinor : -amountMinor;
}

export type LedgerTotals = { incomeMinor: number; expenseMinor: number; netMinor: number; count: number };

/** Totals of non-voided entries. */
export function ledgerTotals(entries: ReadonlyArray<{ kind: LedgerKindValue; amountMinor: number; voidedAt?: Date | string | null }>): LedgerTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.voidedAt) continue;
    count += 1;
    if (entry.kind === "INCOME") incomeMinor += entry.amountMinor;
    else expenseMinor += entry.amountMinor;
  }
  return { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor, count };
}

/**
 * Running balance after each entry, in the order given (oldest first).
 * Voided entries carry the balance unchanged.
 */
export function runningBalances(entries: ReadonlyArray<{ kind: LedgerKindValue; amountMinor: number; voidedAt?: Date | string | null }>, openingMinor = 0): number[] {
  let balance = openingMinor;
  return entries.map((entry) => {
    if (!entry.voidedAt) balance += signedAmount(entry.kind, entry.amountMinor);
    return balance;
  });
}

// ───────────── Invoice lines ─────────────

export type InvoiceItem = {
  description: string;
  /** Up to two decimals (1.5 hours). */
  quantity: number;
  unitMinor: number;
  /** Optional tax rate in basis points (1800 = 18 %). */
  taxBps?: number;
};

export const MAX_TAX_BPS = 10_000;

/** quantity × unit price, rounded half away from zero to whole minor units. */
export function lineSubtotalMinor(item: Pick<InvoiceItem, "quantity" | "unitMinor">): number {
  const hundredths = Math.round(item.quantity * 100);
  return roundHalfAway((hundredths * item.unitMinor) / 100);
}

export function lineTaxMinor(item: InvoiceItem): number {
  if (!item.taxBps) return 0;
  return roundHalfAway((lineSubtotalMinor(item) * item.taxBps) / 10_000);
}

export type InvoiceTotals = { subtotalMinor: number; taxMinor: number; totalMinor: number };

export function invoiceTotals(items: ReadonlyArray<InvoiceItem>): InvoiceTotals {
  let subtotalMinor = 0;
  let taxMinor = 0;
  for (const item of items) {
    subtotalMinor += lineSubtotalMinor(item);
    taxMinor += lineTaxMinor(item);
  }
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** "18" / "12.5" → basis points; null when not a percentage between 0 and 100 with ≤ 2 decimals. */
export function parsePercentToBps(input: string): number | null {
  const cleaned = input.trim().replace(/%$/, "").trim();
  if (cleaned === "") return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps <= MAX_TAX_BPS ? bps : null;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

/** "₹" for INR, "¥" for JPY; the code itself when Intl has no symbol. */
export function currencySymbol(currency: string, locale = "en-IN"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

/** Minor units → a plain decimal string for inputs and CSV ("1250.50"), no grouping or symbol. */
export function minorToDecimalString(amountMinor: number, currency = "INR"): string {
  const digits = currencyMinorDigits(currency);
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  if (digits === 0) return `${negative ? "-" : ""}${abs}`;
  const factor = 10 ** digits;
  const whole = Math.floor(abs / factor);
  const fraction = String(abs % factor).padStart(digits, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
