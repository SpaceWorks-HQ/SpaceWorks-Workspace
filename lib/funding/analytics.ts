import { advanceDate } from "./schema";

export type MoneyGift = { id: string; contactId: string | null; dateOn: Date | null; amountMinor: number; currency: string; status: string; details: unknown; archivedAt?: Date | null };
export function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function receivedGifts(gifts: MoneyGift[]) { return gifts.filter(g => g.status === "RECEIVED" && !g.archivedAt); }
export function moneyTotals(rows: Array<{ amountMinor: number; currency: string }>) {
  const values: Record<string, number> = {};
  for (const row of rows) values[row.currency] = (values[row.currency] ?? 0) + row.amountMinor;
  return values;
}
/** Estimates never mix currencies; in-kind gifts are reported separately from cash. */
export function donationSummary(gifts: MoneyGift[], now: Date, majorMinor = 1000000, majorCurrency = "INR") {
  const live = receivedGifts(gifts); const year = now.getUTCFullYear();
  const byDonor = new Map<string, MoneyGift[]>();
  for (const gift of live) if (gift.contactId) byDonor.set(gift.contactId, [...(byDonor.get(gift.contactId) ?? []), gift]);
  const lapsedBefore = advanceDate(now.toISOString().slice(0, 10), -12);
  const donors = [...byDonor.entries()].map(([contactId, history]) => {
    const ordered = [...history].sort((a, b) => (a.dateOn?.getTime() ?? 0) - (b.dateOn?.getTime() ?? 0));
    const first = ordered[0]!.dateOn; const last = ordered.at(-1)!.dateOn;
    const totals = moneyTotals(history.filter(g => object(g.details).mode !== "IN_KIND"));
    return { contactId, gifts: history.length, totals, first, last,
      segments: [history.length === 1 ? "First-time" : "Repeat", ...(history.some(g => object(g.details).pledgeId) ? ["Recurring"] : []), ...(last && last.toISOString().slice(0, 10) < lapsedBefore ? ["Lapsed"] : []), ...((totals[majorCurrency] ?? 0) >= majorMinor ? ["Major"] : [])],
      history: ordered.map(g => g.id),
    };
  });
  const campaigns = new Map<string, MoneyGift[]>();
  for (const gift of live) { const id = object(gift.details).campaignId; if (typeof id === "string" && id) campaigns.set(id, [...(campaigns.get(id) ?? []), gift]); }
  const previous = new Set(live.filter(g => g.dateOn?.getUTCFullYear() === year - 1).map(g => g.contactId).filter(Boolean));
  const current = new Set(live.filter(g => g.dateOn?.getUTCFullYear() === year).map(g => g.contactId).filter(Boolean));
  const retained = [...previous].filter(id => current.has(id)).length;
  return { year, cash: moneyTotals(live.filter(g => object(g.details).mode !== "IN_KIND")), inKind: moneyTotals(live.filter(g => object(g.details).mode === "IN_KIND")), donors,
    retention: { previousDonors: previous.size, retained, percent: previous.size ? Math.round(retained / previous.size * 100) : null },
    campaigns: [...campaigns.entries()].map(([id, tagged]) => ({ id, gifts: tagged.length, cash: moneyTotals(tagged.filter(g => object(g.details).mode !== "IN_KIND")), inKind: moneyTotals(tagged.filter(g => object(g.details).mode === "IN_KIND")) })),
  };
}
export function pledgeDue(pledge: { id: string; amountMinor: number; currency: string; details: unknown }, gifts: MoneyGift[]) {
  const d = object(pledge.details); const first = String(d.nextExpectedOn ?? "");
  if (!first || pledge.amountMinor <= 0) return null;
  const paid = receivedGifts(gifts).filter(g => object(g.details).pledgeId === pledge.id && object(g.details).mode !== "IN_KIND" && g.currency === pledge.currency).reduce((sum, g) => sum + g.amountMinor, 0);
  const count = Math.floor(paid / pledge.amountMinor);
  if (d.frequency === "ONCE") return count > 0 ? null : first;
  const months = d.frequency === "YEARLY" ? 12 : d.frequency === "QUARTERLY" ? 3 : 1;
  if (count * months > 2400) return null;
  const next = advanceDate(first, count * months);
  return d.endOn && next > String(d.endOn) ? null : next;
}
export function runway(cashMinor: number, incomeMinor: number, expensesMinor: number) {
  const burnMinor = expensesMinor - incomeMinor;
  return { burnMinor, months: cashMinor <= 0 ? 0 : burnMinor <= 0 ? null : Math.round(cashMinor / burnMinor * 10) / 10 };
}
export function progress(value: number, target: number) { return target > 0 ? Math.max(0, Math.min(100, Math.round(value / target * 100))) : 0; }
const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function words(n: number): string {
  if (n < 20) return SMALL[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + words(n % 10) : "");
  if (n < 1000) return words(Math.floor(n / 100)) + " hundred" + (n % 100 ? " " + words(n % 100) : "");
  for (const [size, label] of [[10000000, "crore"], [100000, "lakh"], [1000, "thousand"]] as const) if (n >= size) return words(Math.floor(n / size)) + " " + label + (n % size ? " " + words(n % size) : "");
  return "";
}
export function rupeesInWords(minor: number) { return `${words(Math.floor(minor / 100))} rupees${minor % 100 ? ` and ${words(minor % 100)} paise` : ""} only`; }
