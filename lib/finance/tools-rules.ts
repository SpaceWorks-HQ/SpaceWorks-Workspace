/** Pure calculations for manually entered finance records. No tax rates are assumed. */
import { z } from "zod";
import { isoDateSchema } from "@/lib/finance/schemas";
import { isNegativeMoney } from "@/lib/finance/money";
import { parseMoneyToMinor } from "@/lib/format/money";

export const MAX_MINOR = 2_147_483_647;
export const minorSchema = z.number().int().min(0).max(MAX_MINOR);
export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code.")
  .refine((v) => {
    try {
      new Intl.NumberFormat("en", { style: "currency", currency: v });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid currency.");
export const monthSchema = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Choose a month between 2000 and 2099.");
const id = z.string().trim().min(1).max(128);
const optionalId = z
  .string()
  .trim()
  .max(128)
  .nullish()
  .transform((v) => v || null);
const name = z.string().trim().min(1, "Enter a name.").max(120);
const text = z
  .string()
  .trim()
  .max(4000)
  .nullish()
  .transform((v) => v || null);
const shortText = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => v || null);
const date = isoDateSchema;
const optionalDate = z
  .string()
  .nullish()
  .transform((v) => v || null)
  .pipe(date.nullable());
export const attachmentTypes = [
  "STAGED",
  "LEDGER",
  "BILL",
  "FUND",
  "PAY_PROFILE",
  "PAY_RUN",
  "DISBURSEMENT",
  "MONTH",
] as const;
export type AttachmentType = (typeof attachmentTypes)[number];
export const attachmentTypeSchema = z.enum(attachmentTypes);
export const INCOME_SOURCES = [
  "DONATION",
  "GRANT",
  "SPONSORSHIP",
  "FEES",
  "OTHER",
] as const;
export const centreKinds = [
  "EVENT",
  "PROGRAMME",
  "PROJECT",
  "TEAM",
  "OTHER",
] as const;
export const disbursementKinds = [
  "HONORARIUM",
  "STIPEND",
  "PRIZE",
  "SCHOLARSHIP",
  "BENEFICIARY_SUPPORT",
  "REIMBURSEMENT",
  "ADVANCE",
  "OTHER",
] as const;
export const tagsSchema = z.object({
  fundId: optionalId,
  costCentreId: optionalId,
  accountId: optionalId,
  categoryId: optionalId,
  purpose: shortText,
});
export const taxSchema = z.object({
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .nullish()
    .transform((v) => v || null),
  taxableMinor: minorSchema.default(0),
  cgstMinor: minorSchema.default(0),
  sgstMinor: minorSchema.default(0),
  igstMinor: minorSchema.default(0),
  tdsMinor: minorSchema.default(0),
});
const files = z.array(id).max(10).default([]);
export const entryToolSchema = z.object({
  ...tagsSchema.shape,
  ...taxSchema.shape,
  kind: z.enum(["INCOME", "EXPENSE"]),
  amountMinor: minorSchema.positive(),
  currency: currencySchema,
  occurredOn: date,
  description: name,
  counterparty: shortText,
  invoiceNumber: shortText,
  incomeSource: z.enum(INCOME_SOURCES).default("OTHER"),
  budgetId: optionalId,
  fileIds: files,
});
export const toolSchemas = {
  fund: z.object({
    id: optionalId,
    name,
    restricted: z.boolean().default(false),
    currency: currencySchema,
    funder: shortText,
    notes: text,
    archived: z.boolean().default(false),
  }),
  centre: z.object({
    id: optionalId,
    name,
    kind: z.enum(centreKinds),
    projectId: optionalId,
    externalReference: shortText,
    externalUrl: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => v || null)
      .pipe(
        z
          .url()
          .refine((v) => /^https?:\/\//.test(v), "Use an http or https link.")
          .nullable(),
      ),
    notes: text,
    archived: z.boolean().default(false),
  }),
  budget: z
    .object({
      id: optionalId,
      name,
      currency: currencySchema,
      amountMinor: minorSchema.positive(),
      periodStart: date,
      periodEnd: date,
      categoryId: optionalId,
      costCentreId: optionalId,
      varianceNote: text,
    })
    .refine(
      (v) => v.periodEnd >= v.periodStart,
      "The end date must follow the start date.",
    ),
  entry: entryToolSchema,
  tags: z.object({
    entryId: id,
    ...tagsSchema.shape,
    incomeSource: z.enum(INCOME_SOURCES),
    invoiceNumber: shortText,
  }),
  bill: z
    .object({
      id: optionalId,
      vendor: name,
      number: name,
      issuedOn: date,
      dueOn: date,
      amountMinor: minorSchema.positive(),
      currency: currencySchema,
      ...taxSchema.shape,
      ...tagsSchema.shape,
      ownerId: optionalId,
      notes: text,
      fileIds: files,
    })
    .refine(
      (v) => v.dueOn >= v.issuedOn,
      "The due date must follow the bill date.",
    )
    .refine(
      (v) => v.tdsMinor <= v.amountMinor,
      "TDS cannot exceed the bill amount.",
    ),
  billPayment: z.object({
    billId: id,
    paymentKey: z.uuid(),
    amountMinor: minorSchema.positive(),
    paidOn: date,
    reference: name,
    post: z.boolean().default(true),
  }),
  account: z.object({
    name,
    currency: currencySchema,
    openingMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR),
    openingOn: date,
  }),
  monthStart: z.object({ month: monthSchema }),
  step: z.object({
    id: optionalId,
    month: monthSchema,
    title: name,
    ownerId: optionalId,
    done: z.boolean().default(false),
    notes: text,
    remove: z.boolean().default(false),
  }),
  mark: z.object({ entryId: id, reconciled: z.boolean() }),
  reconcile: z.object({
    accountId: id,
    upTo: date,
    statementMinor: z.number().int().min(-MAX_MINOR).max(MAX_MINOR),
    notes: text,
    signOff: z.boolean().default(false),
  }),
  close: z.object({ month: monthSchema, reopen: z.boolean().default(false) }),
  review: z.object({ month: monthSchema, notes: text }),
  threshold: z.object({
    categoryId: id,
    currency: currencySchema,
    thresholdMinor: minorSchema.positive(),
  }),
  remind: z.object({ entryId: id }),
  grant: z.object({ userId: id, access: z.enum(["NONE", "VIEW", "MANAGE"]) }),
  payProfile: z.object({
    id: optionalId,
    name,
    userId: optionalId,
    kind: z.enum(["STAFF", "CONSULTANT", "VOLUNTEER", "INTERN"]),
    currency: currencySchema,
    rateMinor: minorSchema,
    rateBasis: z.enum(["MONTH", "DAY", "HOUR", "ASSIGNMENT"]),
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^$|^[A-Z]{5}[0-9]{4}[A-Z]$/,
        "Enter a valid PAN, or leave it blank.",
      )
      .default(""),
    bankLast4: z
      .string()
      .regex(/^$|^\d{4}$/, "Enter only the last four account digits.")
      .default(""),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^$|^[A-Z]{4}0[A-Z0-9]{6}$/,
        "Enter a valid IFSC, or leave it blank.",
      )
      .default(""),
    clearPan: z.boolean().default(false),
    clearBank: z.boolean().default(false),
    pfApplicable: z.boolean().default(false),
    esiApplicable: z.boolean().default(false),
    ptApplicable: z.boolean().default(false),
    tdsSection: shortText,
    costCentreId: optionalId,
    archived: z.boolean().default(false),
  }),
  payRun: z.object({
    id: optionalId,
    profileId: id,
    month: monthSchema,
    grossMinor: minorSchema,
    allowancesMinor: minorSchema.default(0),
    pfMinor: minorSchema.default(0),
    esiMinor: minorSchema.default(0),
    ptMinor: minorSchema.default(0),
    tdsMinor: minorSchema.default(0),
    advancesMinor: minorSchema.default(0),
    otherMinor: minorSchema.default(0),
    ...tagsSchema.shape,
    notes: text,
  }),
  payBookkeeping: z.object({ runId: id, ...tagsSchema.shape }),
  payTransition: z.object({
    runId: id,
    transition: z.enum(["APPROVE", "PAY", "POST", "REOPEN"]),
    paidOn: optionalDate,
    reference: shortText,
  }),
  disbursement: z
    .object({
      id: optionalId,
      payee: name,
      purpose: name,
      kind: z.enum(disbursementKinds),
      amountMinor: minorSchema.positive(),
      tdsMinor: minorSchema.default(0),
      currency: currencySchema,
      ...tagsSchema.omit({ purpose: true }).shape,
      ownerId: optionalId,
      dueOn: optionalDate,
      notes: text,
      fileIds: files,
    })
    .refine(
      (v) => v.tdsMinor <= v.amountMinor,
      "TDS cannot exceed the payout amount.",
    ),
  disbursementTransition: z.object({
    id,
    transition: z.enum(["REQUEST_APPROVAL", "PAY", "SETTLE"]),
    paidOn: optionalDate,
    reference: shortText,
    settledMinor: minorSchema.default(0),
  }),
} as const;
export type ToolOperation = keyof typeof toolSchemas;

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
