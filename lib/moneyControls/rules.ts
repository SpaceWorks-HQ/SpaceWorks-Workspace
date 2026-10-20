import { z } from "zod";
import { isValidCurrency, parseMoneyToMinor } from "@/lib/format/money";
export const KINDS = [
  "FLOAT",
  "VOUCHER",
  "COUNT",
  "REPLENISHMENT",
  "HANDOVER",
  "DEPOSIT",
  "TRANSFER",
  "ASSET_CATEGORY",
  "SCHEDULE",
  "VERIFICATION",
  "DISPOSAL",
  "ASSIGNMENT",
  "TDS_DEDUCTION",
  "CERTIFICATE",
  "FILING",
  "FUND_RULE",
] as const;
export type Kind = (typeof KINDS)[number];
export type Section = "cash" | "assets" | "tds" | "funds";
export const SECTIONS: Record<Section, Kind[]> = {
  cash: [
    "FLOAT",
    "VOUCHER",
    "COUNT",
    "REPLENISHMENT",
    "HANDOVER",
    "DEPOSIT",
    "TRANSFER",
  ],
  assets: [
    "ASSET_CATEGORY",
    "SCHEDULE",
    "VERIFICATION",
    "DISPOSAL",
    "ASSIGNMENT",
  ],
  tds: ["TDS_DEDUCTION", "CERTIFICATE", "FILING"],
  funds: ["FUND_RULE"],
};
export const LABELS: Record<Kind, string> = {
  FLOAT: "Cash float",
  VOUCHER: "Cash voucher",
  COUNT: "Cash count",
  REPLENISHMENT: "Replenishment request",
  HANDOVER: "Custodian handover",
  DEPOSIT: "Security deposit",
  TRANSFER: "Account transfer",
  ASSET_CATEGORY: "Depreciation category",
  SCHEDULE: "Fixed asset",
  VERIFICATION: "Asset verification",
  DISPOSAL: "Asset disposal",
  ASSIGNMENT: "IT assignment",
  TDS_DEDUCTION: "TDS deducted by us",
  CERTIFICATE: "TDS certificate",
  FILING: "Quarterly return",
  FUND_RULE: "Fund restrictions",
};
export const sectionFor = (kind: Kind): Section =>
  (Object.keys(SECTIONS) as Section[]).find((s) => SECTIONS[s].includes(kind))!;
export const words = (s: string) =>
  s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const dateSchema = z
  .string()
  .refine(
    (s) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Choose a valid date.",
  );
const id = z
  .string()
  .trim()
  .max(64)
  .regex(/^[a-zA-Z0-9_-]*$/)
  .default("");
const text = z.string().trim().max(300).default("");
const notes = z.string().trim().max(5000).default("");
export const minor = z.number().int().min(0).max(2_000_000_000);
const optionalDate = z.union([dateSchema, z.literal("")]).default("");
export const fiscalYearSchema = z.coerce.number().int().min(2000).max(2200);
const quarter = z.enum(["Q1", "Q2", "Q3", "Q4", "ANNUAL"]);
export const detailsSchemas = {
  FLOAT: z.object({}),
  VOUCHER: z.object({ payee: text, reference: text }),
  COUNT: z.object({ denominations: z.string().trim().min(1).max(3000) }),
  REPLENISHMENT: z.object({ reference: text }),
  HANDOVER: z.object({ reference: text }),
  DEPOSIT: z.object({
    direction: z.enum(["GIVEN", "RECEIVED"]),
    counterparty: z.string().trim().min(1).max(200),
    reference: text,
  }),
  TRANSFER: z.object({ reference: z.string().trim().min(1).max(300) }),
  ASSET_CATEGORY: z.object({
    method: z.enum(["SLM", "WDV"]),
    lifeYears: z.coerce.number().int().min(1).max(100),
    rateBps: z.coerce.number().int().min(1).max(10000),
    residualMinor: minor.default(0),
    taxBlockNote: notes,
  }),
  SCHEDULE: z.object({
    categoryRecordId: id.pipe(z.string().min(1)),
    fundingSource: text,
  }),
  VERIFICATION: z.object({ condition: z.string().trim().min(1).max(300) }),
  DISPOSAL: z.object({
    method: z.enum(["SALE", "SCRAP", "DONATION"]),
    counterparty: text,
    reference: text,
  }),
  ASSIGNMENT: z.object({
    condition: z.string().trim().min(1).max(300),
    reference: text,
  }),
  TDS_DEDUCTION: z.object({
    payee: z.string().trim().min(1).max(200),
    contactId: id,
    section: z.string().trim().min(1).max(100),
    fiscalYear: fiscalYearSchema,
    quarter,
    grossMinor: minor,
    reference: text,
  }),
  CERTIFICATE: z.object({
    payee: z.string().trim().min(1).max(200),
    contactId: id,
    section: text,
    fiscalYear: fiscalYearSchema,
    quarter,
    direction: z.enum(["ISSUED", "RECEIVED"]),
    form: z.string().trim().min(1).max(100),
    certificateNumber: z.string().trim().min(1).max(200),
    deliveredOn: optionalDate,
  }),
  FILING: z.object({
    fiscalYear: fiscalYearSchema,
    quarter,
    form: z.string().trim().min(1).max(100),
    acknowledgement: text,
  }),
  FUND_RULE: z.object({
    allowedCategoryIds: z.array(z.string().min(1).max(64)).max(100).default([]),
    eligibilityMode: z.enum(["BLOCK", "WARN"]),
    budgetMode: z.enum(["BLOCK", "WARN"]),
    duplicateMode: z.enum(["BLOCK", "WARN"]),
  }),
} as const;
export const recordSchema = z
  .object({
    id,
    kind: z.enum(KINDS),
    title: z.string().trim().min(1).max(200),
    ownerId: id,
    accountId: id,
    otherAccountId: id,
    assetId: id,
    fundId: id,
    categoryId: id,
    parentId: id,
    complianceId: id,
    checklistRunId: id,
    amountMinor: minor.default(0),
    currency: z.string().length(3).refine(isValidCurrency),
    occurredOn: dateSchema,
    endsOn: optionalDate,
    dueOn: optionalDate,
    reminderDays: z.coerce.number().int().min(0).max(365).default(7),
    payroll: z.boolean().default(false),
    notes,
    details: z.unknown(),
  })
  .superRefine((v, c) => {
    if (v.endsOn && v.endsOn < v.occurredOn)
      c.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "Choose an end date after the start date.",
      });
  });
export const transitionSchema = z.object({
  id: id.pipe(z.string().min(1)),
  operation: z.enum([
    "POST",
    "REQUEST",
    "SIGN_OUT",
    "SIGN_IN",
    "RETURN",
    "ACKNOWLEDGE",
    "SUBMITTED",
    "ACCEPTED",
    "PAID",
    "CANCEL",
  ]),
  occurredOn: dateSchema,
  amountMinor: minor.default(0),
  reference: text,
  notes,
  operationKey: z.uuid(),
});
export const querySchema = z.object({
  section: z.enum(["cash", "assets", "tds", "funds"]).default("cash"),
  q: z.string().trim().max(100).default(""),
  status: z.string().max(40).default(""),
  owner: id,
  fundId: id,
  quarter: z
    .union([z.enum(["Q1", "Q2", "Q3", "Q4", "ANNUAL"]), z.literal("")])
    .default(""),
  kind: z.union([z.enum(KINDS), z.literal("")]).default(""),
  from: optionalDate,
  to: optionalDate,
  fiscalYear: fiscalYearSchema.default(2026),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type ControlsQuery = z.input<typeof querySchema>;
export type RecordInput = z.input<typeof recordSchema>;
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

export type EditableControl = {
  id: string;
  kind: Kind;
  title: string;
  currency: string;
  occurredOn: string;
  endsOn: string;
  dueOn: string;
  amountMinor: number;
  details: unknown;
  [key: string]: unknown;
};
