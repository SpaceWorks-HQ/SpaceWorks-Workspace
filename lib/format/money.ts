/**
 * Money is stored as integer minor units (paise for INR) and formatted with
 * Intl so currencies with other minor-unit counts (JPY, KWD) render correctly.
 */

const DEFAULT_LOCALE = "en-IN";

/** Number of minor units in one major unit for a currency (INR → 2, JPY → 0). */
export function currencyMinorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Is this an ISO 4217 code Intl understands? */
export function isValidCurrency(currency: string): boolean {
  if (!/^[A-Z]{3}$/.test(currency)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency });
    return true;
  } catch {
    return false;
  }
}

/** "₹1,250.00" from 125000 minor units. */
export function formatMoney(amountMinor: number, currency = "INR", options: { locale?: string; signDisplay?: Intl.NumberFormatOptions["signDisplay"] } = {}): string {
  const digits = currencyMinorDigits(currency);
  const major = amountMinor / 10 ** digits;
  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: options.signDisplay ?? "auto",
  }).format(major);
}

/** Compact form for stat cards: "₹1.2L", "₹3.4K" (en-IN) without decimals noise. */
export function formatMoneyCompact(amountMinor: number, currency = "INR", locale = DEFAULT_LOCALE): string {
  const major = amountMinor / 10 ** currencyMinorDigits(currency);
  return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(major);
}

/**
 * Parse a user-typed amount ("1,250.5", "₹ 99") into integer minor units.
 * Returns null for anything that is not a non-negative number with at most
 * the currency's minor digits.
 */
export function parseMoneyToMinor(input: string, currency = "INR"): number | null {
  const digits = currencyMinorDigits(currency);
  const cleaned = input.replace(/[\s,]/g, "").replace(/^[^\d.]+/, "");
  const pattern = digits > 0 ? new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`) : /^\d+$/;
  if (!pattern.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}
