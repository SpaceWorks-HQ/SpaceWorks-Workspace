import { z } from "zod";
import type { DocumentLine, Calculation } from "./types";
export type {
  DocumentLine,
  DraftInput,
  Calculation,
  TaxProfile,
} from "./types";
import { isValidCurrency, parseMoneyToMinor } from "@/lib/format/money";

export const TYPES = [
  "COMMERCIAL_INVOICE",
  "PAYSLIP",
  "TAX_INVOICE",
  "BILL_OF_SUPPLY",
  "RECEIPT_VOUCHER",
  "REFUND_VOUCHER",
  "PAYMENT_VOUCHER",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "PAYMENT_RECEIPT",
  "PAYMENT_REFUND",
  "DONATION_RECEIPT",
  "DONATION_CERTIFICATE",
  "FCRA_RECEIPT",
  "CSR_UC",
  "GOVERNMENT_UC",
  "APPOINTMENT",
  "VOLUNTEER",
  "INTERNSHIP",
  "EXPERIENCE",
  "NOC",
  "PARTICIPATION",
  "VAT_INVOICE",
  "US_ACKNOWLEDGEMENT",
  "GENERIC_RECEIPT",
] as const;
export type DocumentType = (typeof TYPES)[number];
export const LETTERS: readonly string[] = [
  "APPOINTMENT",
  "VOLUNTEER",
  "INTERNSHIP",
  "EXPERIENCE",
  "NOC",
  "PARTICIPATION",
];
export const GST_TYPES: readonly string[] = [
  "TAX_INVOICE",
  "BILL_OF_SUPPLY",
  "RECEIPT_VOUCHER",
  "REFUND_VOUCHER",
  "PAYMENT_VOUCHER",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
];
export const INVOICES: readonly string[] = [
  "COMMERCIAL_INVOICE",
  "TAX_INVOICE",
  "BILL_OF_SUPPLY",
  "VAT_INVOICE",
  "DEBIT_NOTE",
];
export const ALLOCATABLE_RECEIPTS: readonly string[] = [
  "PAYMENT_RECEIPT",
  "RECEIPT_VOUCHER",
  "GENERIC_RECEIPT",
];
export const RECEIPTS: readonly string[] = [
  "PAYMENT_RECEIPT",
  "RECEIPT_VOUCHER",
  "DONATION_RECEIPT",
  "FCRA_RECEIPT",
  "GENERIC_RECEIPT",
];
export const label = (value: string) =>
  ({
    CSR_UC: "CSR utilisation certificate",
    GOVERNMENT_UC: "Government grant utilisation certificate",
    DONATION_CERTIFICATE: "Donation certificate (10BE / 114)",
    NOC: "No objection letter",
    US_ACKNOWLEDGEMENT: "US donation acknowledgement",
  })[value] ??
  value
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
    "Enter a valid date.",
  );
const optionalDate = z.union([dateSchema, z.literal("")]).default("");
const text = z.string().trim().max(300).default("");
const long = z.string().trim().max(12000).default("");
const id = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_-]*$/)
  .default("");
const amount = z.number().int().min(0).max(2147483647);
export const lineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.string().regex(/^\d{1,6}(\.\d{1,3})?$/),
  unitMinor: amount,
  discountMinor: amount.default(0),
  hsn: text,
  unit: text,
  rateBps: z.number().int().min(0).max(10000),
  cessBps: z.number().int().min(0).max(10000).default(0),
  exempt: z.boolean().default(false),
  exemption: text,
  ruleId: id,
});

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
export function financialYear(date: string, start = 4) {
  const [year, month] = date.split("-").map(Number);
  const y = month < start ? year - 1 : year;
  return `${y}-${String(y + 1).slice(-2)}`;
}
export function serialNumber(
  prefix: string,
  fy: string,
  n: number,
  padding = 5,
  indianGst = true,
) {
  const number = `${prefix}/${fy.slice(2, 4)}${fy.slice(-2)}/${String(n).padStart(padding, "0")}`;
  if (
    !/^[A-Za-z0-9/-]+$/.test(number) ||
    (indianGst && number.length > 16) ||
    !Number.isSafeInteger(n) ||
    n < 1
  )
    throw new Error("Choose a shorter series prefix or padding.");
  return number;
}
const divRound = (a: bigint, b: bigint) => (a + b / BigInt(2)) / b;
const bounded = (n: bigint) => {
  if (n < BigInt(0) || n > BigInt(2147483647))
    throw new Error("This amount is above the supported document limit.");
  return Number(n);
};
export function calculate(
  lines: DocumentLine[],
  mode: "INTRA" | "INTER" | "VAT" | "NONE",
  roundRupee = false,
  reverseCharge = false,
): Calculation {
  const rows = lines.map((raw) => {
    const l = lineSchema.parse(raw);
    const q = BigInt(l.quantity.replace(".", ""));
    const scale = BigInt(10) ** BigInt((l.quantity.split(".")[1] ?? "").length);
    if (q === BigInt(0)) throw new Error("Quantity must be greater than zero.");
    const gross = divRound(q * BigInt(l.unitMinor), scale),
      taxable = gross - BigInt(l.discountMinor);
    if (taxable < BigInt(0))
      throw new Error("Discount cannot exceed the line value.");
    const taxed = !l.exempt && mode !== "NONE";
    const tax = taxed
      ? divRound(taxable * BigInt(l.rateBps), BigInt(10000))
      : BigInt(0);
    const cgst =
      mode === "INTRA"
        ? divRound(taxable * BigInt(taxed ? l.rateBps : 0), BigInt(20000))
        : BigInt(0);
    const sgst = mode === "INTRA" ? tax - cgst : BigInt(0);
    const cess = taxed
      ? divRound(taxable * BigInt(l.cessBps), BigInt(10000))
      : BigInt(0);
    return {
      ...l,
      grossMinor: bounded(gross),
      taxableMinor: bounded(taxable),
      cgstMinor: bounded(cgst),
      sgstMinor: bounded(sgst),
      igstMinor: mode === "INTER" ? bounded(tax) : 0,
      vatMinor: mode === "VAT" ? bounded(tax) : 0,
      cessMinor: bounded(cess),
    };
  });
  const sum = (
    key:
      | "taxableMinor"
      | "cgstMinor"
      | "sgstMinor"
      | "igstMinor"
      | "cessMinor"
      | "vatMinor",
  ) => bounded(rows.reduce((s, l) => s + BigInt(l[key]), BigInt(0)));
  const taxableMinor = sum("taxableMinor"),
    cgstMinor = sum("cgstMinor"),
    sgstMinor = sum("sgstMinor"),
    igstMinor = sum("igstMinor"),
    cessMinor = sum("cessMinor"),
    vatMinor = sum("vatMinor");
  const subtotal = bounded(
    BigInt(taxableMinor) +
      BigInt(
        reverseCharge
          ? 0
          : cgstMinor + sgstMinor + igstMinor + cessMinor + vatMinor,
      ),
  );
  const totalMinor = roundRupee
    ? bounded(divRound(BigInt(subtotal), BigInt(100)) * BigInt(100))
    : subtotal;
  return {
    policy: "minor-unit-half-up-v1",
    mode,
    rows,
    taxableMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    cessMinor,
    vatMinor,
    roundOffMinor: totalMinor - subtotal,
    totalMinor,
  };
}

export function ageing(dueOn: string, today: string) {
  const days = Math.max(
    0,
    Math.floor((Date.parse(today) - Date.parse(dueOn)) / 86400000),
  );
  return days <= 30
    ? "0–30"
    : days <= 60
      ? "31–60"
      : days <= 90
        ? "61–90"
        : "90+";
}
const small = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
function words(n: number): string {
  if (n < 20) return small[n];
  if (n < 100)
    return (
      [
        "",
        "",
        "Twenty",
        "Thirty",
        "Forty",
        "Fifty",
        "Sixty",
        "Seventy",
        "Eighty",
        "Ninety",
      ][Math.floor(n / 10)] + (n % 10 ? "-" + small[n % 10] : "")
    );
  for (const [size, name] of [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"],
    [100, "Hundred"],
  ] as const)
    if (n >= size)
      return (
        words(Math.floor(n / size)) +
        " " +
        name +
        (n % size ? " " + words(n % size) : "")
      );
  return "";
}
export function inrWords(minor: number) {
  return `Rupees ${words(Math.floor(minor / 100))}${minor % 100 ? ` and ${words(minor % 100)} Paise` : ""} Only`;
}
export function mergeLetter(body: string, fields: Record<string, string>) {
  return body.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    if (!Object.hasOwn(fields, key))
      throw new Error(`Unknown merge field: ${key}`);
    return fields[key];
  });
}
export function csvCell(v: unknown) {
  const s = String(v ?? "");
  return (
    '"' + (/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'
  );
}
export function donationForm(date: string) {
  return date < "2026-04-01"
    ? {
        statement: "10BD",
        certificate: "10BE",
        section: "80G",
        version: "1961-2025",
      }
    : {
        statement: "113",
        certificate: "114",
        section: "354",
        version: "2025-2026",
      };
}

export function parseDocumentAmount(
  value: string,
  currency = "INR",
): number | null {
  if (!/^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(value)) return null;
  return parseMoneyToMinor(value, currency);
}

/** Period-specific preparation vocabularies from the published donation forms. */
export function donationReportingCodes(
  date: string,
  idType: string,
  category: string,
  mode: string,
) {
  const current = date >= "2026-04-01";
  const identities: Record<string, string> = current
    ? { PAN: "1", PASSPORT: "2", VOTER_ID: "3", FOREIGN_TIN: "4" }
    : {
        PAN: "1",
        AADHAAR: "2",
        FOREIGN_TIN: "3",
        PASSPORT: "4",
        VOTER_ID: "5",
        DRIVING_LICENCE: "6",
        RATION_CARD: "7",
      };
  const id =
    identities[idType] ??
    (Object.values(identities).includes(idType) ? idType : undefined);
  const categories: Record<string, string> = current
    ? {
        CORPUS: "I",
        VOLUNTARY: "II",
        SPECIFIC_GRANT: "III",
        CSR: "IV",
        OTHER: "V",
      }
    : {
        CORPUS: "Corpus",
        VOLUNTARY: "Others",
        SPECIFIC_GRANT: "Specific grant",
        CSR: "Others",
        OTHER: "Others",
      };
  const modes: Record<string, string> = current
    ? {
        CASH: "I",
        IN_KIND: "II",
        BANK: "III",
        UPI: "III",
        CHEQUE: "III",
        CARD: "III",
        OTHER: "IV",
      }
    : {
        CASH: "Cash",
        IN_KIND: "Kind",
        BANK: "Electronic modes including account payee cheque/draft",
        UPI: "Electronic modes including account payee cheque/draft",
        CHEQUE: "Electronic modes including account payee cheque/draft",
        CARD: "Electronic modes including account payee cheque/draft",
        OTHER: "Others",
      };
  if (!id || !categories[category] || !modes[mode])
    throw new Error(
      "Review the donor identification, donation category and payment mode for this form year.",
    );
  return { idCode: id, category: categories[category], mode: modes[mode] };
}
