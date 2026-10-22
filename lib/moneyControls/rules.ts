import { z } from "zod";
import { isValidCurrency } from "@/lib/format/money";
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
    refundable: z.enum(["YES","NO"]).default("YES"),
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

export { fiscalYear, fiscalQuarter, fyPeriod, depreciation, countDenominations, fundIssues, csv } from "./rules/calculations";
export type { DepreciationBasis, FundCharge, FundRule } from "./rules/calculations";
