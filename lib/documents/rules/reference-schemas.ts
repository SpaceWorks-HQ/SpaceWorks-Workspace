import { z } from "zod";
import { TYPES } from "./catalog";
import {
  dateSchema,
  id,
  long,
  optionalDate,
  text,
} from "./fields";
import { lineSchema } from "./line-schema";

export const registrationSchema = z
  .object({
    kind: z.enum(["GST", "DONATION_APPROVAL", "FCRA", "VAT"]),
    identifier: z.string().trim().min(1).max(100),
    state: text,
    address: long,
    validFrom: dateSchema,
    validTo: dateSchema,
    section: text,
    orderDate: optionalDate,
    reviewed: z.boolean().default(false),
  })
  .refine((v) => v.validTo >= v.validFrom, {
    message: "Check the validity dates.",
    path: ["validTo"],
  });
export const signatorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  designation: text,
  validFrom: dateSchema,
  validTo: dateSchema,
  signatureFileId: id,
});
export const profileSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  fiscalStartMonth: z.number().int().min(1).max(12).default(4),
  upi: text.refine(
    (v) => !v || /^[\w.\-]+@[\w.\-]+$/.test(v),
    "Enter a UPI ID.",
  ),
  paymentInstructions: long,
  upiVerified: z.boolean().default(false),
  logoFileId: id,
  footer: text,
  cin: text,
  contact: text,
  gstScheme: z
    .enum(["REGULAR", "COMPOSITION", "UNREGISTERED"])
    .default("REGULAR"),
  applicability: long,
  reviewedOn: optionalDate,
  eInvoiceRequired: z.boolean().default(false),
});

export const itemSchema = lineSchema
  .omit({ quantity: true, discountMinor: true })
  .extend({
    validFrom: dateSchema,
    validTo: dateSchema,
    source: text,
    reviewedOn: dateSchema,
  });
export const templateSchema = z.object({
  type: z.enum(TYPES),
  body: z.string().min(1).max(12000),
  version: z.string().min(1).max(30),
});
