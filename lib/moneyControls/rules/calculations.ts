import type { z } from "zod";
import { parseMoneyToMinor } from "@/lib/format/money";
import type { detailsSchemas } from "../rules";

export type DepreciationBasis = {
  method: "SLM" | "WDV";
  lifeYears: number;
  rateBps: number;
  residualMinor: number;
};
export function fiscalYear(date: string) {
  const d = new Date(date);
  return d.getUTCFullYear() - (d.getUTCMonth() < 3 ? 1 : 0);
}
export function fiscalQuarter(date: string) {
  return `Q${Math.floor(((new Date(date).getUTCMonth() + 9) % 12) / 3) + 1}`;
}
export function fyPeriod(year: number) {
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
}
/** Internal book schedule: daily proration, nearest minor unit, residual floor. Tax blocks are notes only. */
export function depreciation(
  costMinor: number,
  purchaseOn: string,
  basis: DepreciationBasis,
  year: number,
  disposedOn?: string,
) {
  const first = fiscalYear(purchaseOn);
  let opening = costMinor,
    charge = 0;
  for (let fy = first; fy <= year; fy++) {
    const p = fyPeriod(fy),
      start = Math.max(+new Date(p.from), +new Date(purchaseOn)),
      end = Math.min(
        +new Date(p.to) + 86400000,
        disposedOn ? +new Date(disposedOn) : Infinity,
      );
    const days = Math.max(0, (end - start) / 86400000),
      yearDays = (+new Date(`${fy + 1}-04-01`) - +new Date(p.from)) / 86400000;
    const annual =
      basis.method === "SLM"
        ? (costMinor - basis.residualMinor) / basis.lifeYears
        : (opening * basis.rateBps) / 10000;
    charge = Math.min(
      Math.max(0, opening - basis.residualMinor),
      Math.max(0, Math.round((annual * days) / yearDays)),
    );
    const disposed =
      disposedOn && +new Date(disposedOn) < +new Date(`${fy + 1}-04-01`);
    const disposalMinor = disposed ? opening - charge : 0;
    if (fy === year)
      return {
        openingMinor: opening,
        depreciationMinor: charge,
        disposalMinor,
        closingMinor: opening - charge - disposalMinor,
      };
    opening -= charge + disposalMinor;
  }
  return {
    openingMinor: 0,
    depreciationMinor: 0,
    disposalMinor: 0,
    closingMinor: 0,
  };
}
/** e.g. 500=2, 100=3. Denominations are major units in the account currency. */
export function countDenominations(value: string, currency: string) {
  let total = 0;
  const seen = new Set<number>();
  for (const part of value
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean)) {
    const m = /^(\d+(?:\.\d+)?)\s*=\s*(\d+)$/.exec(part);
    const denomination = m ? parseMoneyToMinor(m[1], currency) : null,
      count = m ? Number(m[2]) : -1;
    if (
      !denomination ||
      count < 0 ||
      !Number.isSafeInteger(count) ||
      seen.has(denomination)
    )
      throw new Error("Use each denomination once, like 500=2, 100=3.");
    seen.add(denomination);
    total += denomination * count;
  }
  if (!seen.size || !Number.isSafeInteger(total) || total > 2_000_000_000)
    throw new Error("Check the cash denominations and total.");
  return total;
}
export type FundCharge = {
  sourceType: string;
  sourceId: string;
  fundId: string;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  occurredOn: Date;
  duplicateKey: string;
  payroll: boolean;
};
export type FundRule = {
  fundId: string;
  amountMinor: number;
  currency: string;
  occurredOn: Date;
  endsOn: Date | null;
  details: z.output<typeof detailsSchemas.FUND_RULE>;
};
export function fundIssues(
  charge: FundCharge,
  rule: FundRule,
  committedMinor: number,
  duplicate: boolean,
) {
  const out: Array<{ message: string; mode: "BLOCK" | "WARN" }> = [];
  if (
    charge.currency !== rule.currency ||
    charge.occurredOn < rule.occurredOn ||
    (rule.endsOn && charge.occurredOn > rule.endsOn) ||
    (rule.details.allowedCategoryIds.length &&
      !rule.details.allowedCategoryIds.includes(charge.categoryId ?? ""))
  )
    out.push({
      message:
        "The fund's currency, period or allowed categories do not cover this charge.",
      mode: rule.details.eligibilityMode,
    });
  if (committedMinor > rule.amountMinor)
    out.push({
      message: "This charge exceeds the fund's eligible budget.",
      mode: rule.details.budgetMode,
    });
  if (duplicate)
    out.push({
      message:
        "This expense reference is already charged to another fund. Review both records.",
      mode: rule.details.duplicateMode,
    });
  return out;
}
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((r) =>
        r
          .map((v) => {
            let s = String(v ?? "");
            if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}

