import { z } from "zod";
import { isoDateSchema } from "@/lib/finance/schemas";

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
export const id = z.string().trim().min(1).max(128);
export const optionalId = z
  .string()
  .trim()
  .max(128)
  .nullish()
  .transform((v) => v || null);
export const name = z.string().trim().min(1, "Enter a name.").max(120);
export const text = z
  .string()
  .trim()
  .max(4000)
  .nullish()
  .transform((v) => v || null);
export const shortText = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => v || null);
export const date = isoDateSchema;
export const optionalDate = z
  .string()
  .nullish()
  .transform((v) => v || null)
  .pipe(date.nullable());
export const attachmentTypes = [
  "STAGED",
  "RECURRING",
  "ADVANCE",
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
export const files = z.array(id).max(10).default([]);
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
