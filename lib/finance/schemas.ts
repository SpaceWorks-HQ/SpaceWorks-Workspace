/**
 * Zod schemas for finance inputs (client-safe so forms can share limits).
 * Amounts arrive as typed strings and are turned into minor units with the
 * workspace currency by the action, never trusted as numbers from the client.
 */

import { z } from "zod";
import { isValidIsoDate } from "@/lib/finance/csv";
import { MAX_TAX_BPS } from "@/lib/finance/money";
import { idSchema } from "@/lib/validation";

export const isoDateSchema = z.string().trim().refine(isValidIsoDate, "Pick a valid date.");
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : null));
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || null)
  .pipe(idSchema.nullable());

export const ledgerKindSchema = z.enum(["INCOME", "EXPENSE"], { message: "Choose income or expense." });

export const ledgerEntrySchema = z.object({
  kind: ledgerKindSchema,
  amount: z.string().trim().min(1, "Enter an amount.").max(24, "Enter an amount."),
  occurredOn: isoDateSchema,
  description: z.string().trim().min(1, "Describe the entry.").max(200, "Keep the description under 200 characters."),
  counterparty: optionalText(120, "Keep the name under 120 characters."),
  categoryId: optionalId,
  budgetId: optionalId,
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Name the category.").max(60, "Keep the name under 60 characters."),
  kind: ledgerKindSchema,
});

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Describe each line.").max(200, "Keep each line under 200 characters."),
  quantity: z.number().positive("Quantities must be above zero.").max(100_000, "That quantity is too large.").refine((q) => Math.abs(Math.round(q * 100) - q * 100) < 1e-6, "Use at most two decimals for quantities."),
  /** Typed unit price in major units; converted with the invoice currency. */
  unitPrice: z.string().trim().min(1, "Enter a unit price.").max(24, "Enter a unit price."),
  taxBps: z.number().int().min(0).max(MAX_TAX_BPS, "Tax must be between 0 and 100%.").optional(),
});

export const invoiceSchema = z
  .object({
    clientName: z.string().trim().min(1, "Enter the client's name.").max(120, "Keep the name under 120 characters."),
    clientEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .optional()
      .transform((value) => value || null)
      .pipe(z.string().email("Enter a valid email address.").nullable()),
    issuedOn: isoDateSchema,
    dueOn: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || null)
      .pipe(isoDateSchema.nullable()),
    notes: optionalText(2000, "Keep the notes under 2,000 characters."),
    items: z.array(invoiceItemSchema).min(1, "Add at least one line.").max(50, "Keep it to 50 lines or fewer."),
  })
  .refine((value) => !value.dueOn || value.dueOn >= value.issuedOn, { message: "The due date can't be before the issue date.", path: ["dueOn"] });

export type LedgerEntryInput = z.input<typeof ledgerEntrySchema>;
export type InvoiceInput = z.input<typeof invoiceSchema>;
