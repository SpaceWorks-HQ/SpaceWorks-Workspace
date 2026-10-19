import type { BillingPeriod } from "@prisma/client";
export function annualCost(amountMinor: number | null, period: BillingPeriod) {
 if (amountMinor == null) return 0;
 return period === "MONTHLY" ? amountMinor * 12 : period === "QUARTERLY" ? amountMinor * 4 : period === "YEARLY" ? amountMinor : 0;
}
export function costTotals(rows: Array<{ amountMinor: number | null; currency: string; period: BillingPeriod; status: string }>) {
 const totals: Record<string, { monthlyMinor: number; yearlyMinor: number }> = {};
 for (const row of rows) {
  if (!["ACTIVE", "CANCELLING"].includes(row.status) || row.amountMinor === null || !["MONTHLY", "QUARTERLY", "YEARLY"].includes(row.period)) continue;
  const annual = annualCost(row.amountMinor, row.period);
  const total = totals[row.currency] ??= { monthlyMinor: 0, yearlyMinor: 0 };
  total.yearlyMinor += annual;
 }
 for (const total of Object.values(totals)) total.monthlyMinor = Math.round(total.yearlyMinor / 12);
 return totals;
}
