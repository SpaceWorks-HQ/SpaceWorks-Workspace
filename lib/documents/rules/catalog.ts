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
