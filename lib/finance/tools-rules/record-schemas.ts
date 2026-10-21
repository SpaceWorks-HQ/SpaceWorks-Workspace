import { z } from "zod";
import {
  MAX_MINOR,
  minorSchema,
  currencySchema,
  monthSchema,
  id,
  optionalId,
  name,
  text,
  shortText,
  date,
  files,
  INCOME_SOURCES,
  centreKinds,
  tagsSchema,
  taxSchema,
  entryToolSchema,
} from "./fields";

export const recordSchemas = {
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
} as const;
