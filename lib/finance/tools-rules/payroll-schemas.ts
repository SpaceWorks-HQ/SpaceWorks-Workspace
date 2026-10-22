import { z } from "zod";
import {
  minorSchema,
  currencySchema,
  monthSchema,
  id,
  optionalId,
  name,
  text,
  shortText,
  optionalDate,
  files,
  disbursementKinds,
  tagsSchema,
} from "./fields";

export const payrollSchemas = {
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
