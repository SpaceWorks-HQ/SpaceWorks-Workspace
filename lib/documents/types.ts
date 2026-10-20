import type { DocumentType } from "./rules";
export type DocumentLine = {
  description: string;
  quantity: string;
  unitMinor: number;
  discountMinor: number;
  hsn: string;
  unit: string;
  rateBps: number;
  cessBps: number;
  exempt: boolean;
  exemption: string;
  ruleId: string;
};
export type DraftInput = {
  id: string;
  type: DocumentType;
  title: string;
  issuedOn: string;
  dueOn: string;
  currency: string;
  registrationId: string;
  signatoryId: string;
  contactId: string;
  organisationId: string;
  personId: string;
  sourceType:
    | ""
    | "INVOICE"
    | "LEDGER"
    | "FUND"
    | "PAY_RUN"
    | "CONTRACT"
    | "DEAL"
    | "FUNDING";
  sourceId: string;
  parentId: string;
  noteAllocations: string;
  partyName: string;
  partyAddress: string;
  partyEmail: string;
  partyTaxId: string;
  deliveryAddress: string;
  partyState: string;
  supplyOn: string;
  placeOfSupply: string;
  placeRule: string;
  supplyCategory:
    | "DOMESTIC"
    | "EXPORT_WITH_TAX"
    | "EXPORT_WITHOUT_TAX"
    | "SEZ_WITH_TAX"
    | "SEZ_WITHOUT_TAX";
  componentOverride: "" | "INTRA" | "INTER";
  overrideReason: string;
  reviewed: boolean;
  reverseCharge: boolean;
  gstAdjustment: boolean;
  roundRupee: boolean;
  lines: DocumentLine[];
  notes: string;
  templateId: string;
  letterBody: string;
  role: string;
  programme: string;
  startsOn: string;
  endsOn: string;
  hours: string;
  paymentOn: string;
  paymentMode:
    "" | "CASH" | "BANK" | "UPI" | "CHEQUE" | "IN_KIND" | "CARD" | "OTHER";
  paymentReference: string;
  cashMinor: number;
  tdsMinor: number;
  tdsSection: string;
  donorIdType: string;
  donorId: string;
  donationCategory: "CORPUS" | "VOLUNTARY" | "SPECIFIC_GRANT" | "CSR" | "OTHER";
  deductionSection: string;
  approvalId: string;
  portalReference: string;
  portalReferenceType: "PRE_ARN" | "CERTIFICATE_ACK";
  portalDate: string;
  filingReference: string;
  fcraAccount: boolean;
  donorCountry: string;
  foreignSourceBasis: string;
  exchangeBasis: string;
  inrMinor: number;
  irnRequired: boolean;
  irn: string;
  acknowledgement: string;
  acknowledgementAt: string;
  signedQr: string;
  ewayReference: string;
  periodStart: string;
  periodEnd: string;
  sanction: string;
  outcomes: string;
  openingMinor: number;
  receiptsMinor: number;
  interestMinor: number;
  expenditureMinor: number;
  refundsMinor: number;
  advancesMinor: number;
  schedules: string;
  benefits: string;
  benefitValueMinor: number;
  vatSterlingMinor: number;
};
export type Calculation = {
  policy: string;
  mode: "INTRA" | "INTER" | "VAT" | "NONE";
  rows: Array<
    DocumentLine & {
      grossMinor: number;
      taxableMinor: number;
      cgstMinor: number;
      sgstMinor: number;
      igstMinor: number;
      vatMinor: number;
      cessMinor: number;
    }
  >;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  cessMinor: number;
  vatMinor: number;
  roundOffMinor: number;
  totalMinor: number;
};
export type TaxProfile = {
  country: string;
  fiscalStartMonth: number;
  upi: string;
  paymentInstructions: string;
  upiVerified: boolean;
  logoFileId: string;
  footer: string;
  cin: string;
  contact: string;
  gstScheme: "REGULAR" | "COMPOSITION" | "UNREGISTERED";
  applicability: string;
  reviewedOn: string;
  eInvoiceRequired: boolean;
};
export type EditorOptions = {
  funding: Array<{ id: string; name: string }>;
  country: string;
  references: Array<{
    id: string;
    kind: string;
    name: string;
    data: Record<string, unknown>;
  }>;
  contacts: Array<{ id: string; name: string }>;
  organisations: Array<{ id: string; name: string; address: string | null }>;
  people: Array<{ id: string; name: string; start: string; end: string }>;
  originals: Array<{ id: string; type: string; status: string; name: string }>;
  funds: Array<{ id: string; name: string }>;
  invoices: Array<{ id: string; name: string }>;
  ledger: Array<{ id: string; name: string }>;
  contracts: Array<{ id: string; name: string }>;
};
