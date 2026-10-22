/** Pure calculations for manually entered finance records. No tax rates are assumed. */
import { isNegativeMoney } from "@/lib/finance/money";
import { parseMoneyToMinor } from "@/lib/format/money";
import { MAX_MINOR, monthSchema } from "./fields";

export type PayAmounts = {
  grossMinor: number;
  allowancesMinor: number;
  pfMinor: number;
  esiMinor: number;
  ptMinor: number;
  tdsMinor: number;
  advancesMinor: number;
  otherMinor: number;
};
export function payTotals(v: PayAmounts) {
  const earningsMinor = v.grossMinor + v.allowancesMinor;
  const deductionsMinor =
    v.pfMinor +
    v.esiMinor +
    v.ptMinor +
    v.tdsMinor +
    v.advancesMinor +
    v.otherMinor;
  if (earningsMinor > MAX_MINOR || deductionsMinor > earningsMinor)
    throw new Error("Deductions must not exceed earnings. Check the amounts.");
  return {
    earningsMinor,
    deductionsMinor,
    netMinor: earningsMinor - deductionsMinor,
  };
}
export function monthPeriod(month: string) {
  monthSchema.parse(month);
  const [year, n] = month.split("-").map(Number);
  return {
    start: `${month}-01`,
    end: new Date(Date.UTC(year!, n!, 0)).toISOString().slice(0, 10),
  };
}
export function billStatus(amount: number, paid: number) {
  return paid >= amount ? "Paid" : paid > 0 ? "Partly paid" : "Unpaid";
}
export function normalizeVendor(value: string | null) {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export type SpendEntry = {
  id: string;
  counterparty: string | null;
  amountMinor: number;
  currency: string;
  occurredOn: Date | string;
  invoiceNumber: string | null;
};
export function possibleDuplicates(entries: SpendEntry[]) {
  const groups = new Map<string, SpendEntry[]>();
  for (const row of entries) {
    const vendor = normalizeVendor(row.counterparty);
    const invoice = normalizeVendor(row.invoiceNumber);
    const keys = [
      ...(vendor ? [`value:${vendor}:${row.currency}:${row.amountMinor}`] : []),
      ...(invoice ? [`invoice:${invoice}`] : []),
    ];
    for (const key of keys) {
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
  }
  const pairs = new Map<string, [string, string]>();
  for (const [key, group] of groups) {
    group.sort((a, b) => +new Date(a.occurredOn) - +new Date(b.occurredOn));
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        if (
          !key.startsWith("invoice:") &&
          +new Date(group[j]!.occurredOn) - +new Date(group[i]!.occurredOn) >
            7 * 86400000
        )
          break;
        const pair = [group[i]!.id, group[j]!.id].sort() as [string, string];
        pairs.set(pair.join(":"), pair);
        if (pairs.size >= 200) return [...pairs.values()];
      }
  }
  return [...pairs.values()];
}
export function moneyInput(
  value: unknown,
  currency: string,
  signed = false,
): number {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return 0;
  if (!signed && isNegativeMoney(raw))
    throw new Error("Enter a positive amount.");
  const n = parseMoneyToMinor(raw, currency);
  if (n === null || Math.abs(n) > MAX_MINOR)
    throw new Error("Enter a valid amount in the selected currency.");
  return signed && isNegativeMoney(raw) ? -n : n;
}
export function label(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
