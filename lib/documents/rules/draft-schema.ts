import { isValidCurrency } from "@/lib/format/money";
import { z } from "zod";
import { TYPES } from "./catalog";
import {
  amount,
  dateSchema,
  id,
  long,
  optionalDate,
  text,
} from "./fields";
import { lineSchema } from "./line-schema";

export const draftSchema = z
  .object({
    id,
    type: z.enum(TYPES),
    title: z.string().trim().min(1).max(200),
    issuedOn: dateSchema,
    dueOn: optionalDate,
    currency: z.string().refine(isValidCurrency, "Choose an ISO currency."),
    registrationId: id,
    signatoryId: id,
    contactId: id,
    organisationId: id,
    personId: id,
    sourceType: z
      .enum([
        "",
        "INVOICE",
        "LEDGER",
        "FUND",
        "PAY_RUN",
        "CONTRACT",
        "DEAL",
        "FUNDING",
      ])
      .default(""),
    sourceId: id,
    parentId: id,
    noteAllocations: long,
    partyName: z.string().trim().min(1).max(300),
    partyAddress: long,
    partyEmail: z.union([z.email(), z.literal("")]).default(""),
    partyTaxId: text,
    deliveryAddress: long,
    partyState: text,
    supplyOn: optionalDate,
    placeOfSupply: text,
    placeRule: text,
    supplyCategory: z
      .enum([
        "DOMESTIC",
        "EXPORT_WITH_TAX",
        "EXPORT_WITHOUT_TAX",
        "SEZ_WITH_TAX",
        "SEZ_WITHOUT_TAX",
      ])
      .default("DOMESTIC"),
    componentOverride: z.enum(["", "INTRA", "INTER"]).default(""),
    overrideReason: text,
    reviewed: z.boolean().default(false),
    reverseCharge: z.boolean().default(false),
    gstAdjustment: z.boolean().default(true),
    roundRupee: z.boolean().default(true),
    lines: z.array(lineSchema).max(100).default([]),
    notes: long,
    templateId: id,
    letterBody: long,
    role: text,
    programme: text,
    startsOn: optionalDate,
    endsOn: optionalDate,
    hours: text,
    paymentOn: optionalDate,
    paymentMode: z
      .enum(["", "CASH", "BANK", "UPI", "CHEQUE", "IN_KIND", "CARD", "OTHER"])
      .default(""),
    paymentReference: text,
    cashMinor: amount.default(0),
    tdsMinor: amount.default(0),
    tdsSection: text,
    donorIdType: text,
    donorId: text,
    donationCategory: z
      .enum(["CORPUS", "VOLUNTARY", "SPECIFIC_GRANT", "CSR", "OTHER"])
      .default("VOLUNTARY"),
    deductionSection: text,
    approvalId: id,
    portalReference: text,
    portalReferenceType: z
      .enum(["PRE_ARN", "CERTIFICATE_ACK"])
      .default("PRE_ARN"),
    portalDate: optionalDate,
    filingReference: text,
    fcraAccount: z.boolean().default(false),
    donorCountry: text,
    foreignSourceBasis: text,
    exchangeBasis: text,
    inrMinor: amount.default(0),
    irnRequired: z.boolean().default(false),
    irn: z.string().max(64).default(""),
    acknowledgement: text,
    acknowledgementAt: text,
    signedQr: z.string().max(6000).default(""),
    ewayReference: text,
    periodStart: optionalDate,
    periodEnd: optionalDate,
    sanction: long,
    outcomes: long,
    openingMinor: amount.default(0),
    receiptsMinor: amount.default(0),
    interestMinor: amount.default(0),
    expenditureMinor: amount.default(0),
    refundsMinor: amount.default(0),
    advancesMinor: amount.default(0),
    schedules: long,
    benefits: long,
    benefitValueMinor: amount.default(0),
    vatSterlingMinor: amount.default(0),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (v.dueOn && v.dueOn < v.issuedOn)
      issue("dueOn", "Due date must follow the issue date.");
    if (v.endsOn && v.startsOn && v.endsOn < v.startsOn)
      issue("endsOn", "Check the engagement dates.");
    if (v.componentOverride && (!v.reviewed || v.overrideReason.length < 5))
      issue("overrideReason", "Review the tax override and record a reason.");
    if (Boolean(v.sourceType) !== Boolean(v.sourceId))
      issue("sourceId", "Choose both the source type and record.");
  });
