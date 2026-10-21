import { z } from "zod";
import { isValidCurrency } from "@/lib/format/money";

export const KINDS = [
  "LEGAL_ENTITY",
  "OBLIGATION",
  "COMMITTEE",
  "TERM",
  "MINUTES",
  "RESOLUTION",
  "CONFLICT",
  "AGM_ITEM",
  "VENDOR",
  "CONTRACT",
  "INSURANCE",
  "LICENCE",
  "REGISTRATION",
  "STATUTORY_REGISTER",
  "RISK",
  "EMERGENCY_PLAN",
  "DRILL",
  "SOP_REVIEW",
  "BOARD_PACK",
] as const;
export type Kind = (typeof KINDS)[number];
export type Section =
  | "compliance"
  | "board"
  | "vendors"
  | "registers"
  | "risk"
  | "reviews"
  | "packs";
export const SECTIONS: Record<Section, Kind[]> = {
  registers: ["INSURANCE", "LICENCE", "REGISTRATION", "STATUTORY_REGISTER"],
  risk: ["RISK", "EMERGENCY_PLAN", "DRILL"],
  reviews: ["SOP_REVIEW"],
  packs: ["BOARD_PACK"],
  compliance: ["LEGAL_ENTITY", "OBLIGATION"],
  board: ["COMMITTEE", "TERM", "MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"],
  vendors: ["VENDOR", "CONTRACT"],
};
export const LABELS: Record<Kind, string> = {
  LEGAL_ENTITY: "Legal entity",
  OBLIGATION: "Obligation",
  COMMITTEE: "Board or committee",
  TERM: "Committee member",
  MINUTES: "Minutes",
  RESOLUTION: "Resolution",
  CONFLICT: "Conflict declaration",
  AGM_ITEM: "AGM checklist item",
  VENDOR: "Vendor",
  CONTRACT: "Contract",
  INSURANCE: "Insurance policy",
  LICENCE: "Licence",
  REGISTRATION: "Registration",
  STATUTORY_REGISTER: "Statutory register",
  RISK: "Risk assessment",
  EMERGENCY_PLAN: "Emergency plan",
  DRILL: "Drill record",
  SOP_REVIEW: "SOP or policy review",
  BOARD_PACK: "Board or report pack",
};
export const STATUSES: Record<Kind, string[]> = {
  INSURANCE: ["ACTIVE", "EXPIRED", "CANCELLED"],
  LICENCE: ["ACTIVE", "EXPIRED", "CANCELLED"],
  REGISTRATION: ["ACTIVE", "EXPIRED", "CANCELLED"],
  STATUTORY_REGISTER: ["CURRENT", "NEEDS_REVIEW"],
  RISK: ["OPEN", "CONTROLLED", "CLOSED"],
  EMERGENCY_PLAN: ["ACTIVE", "NEEDS_REVIEW"],
  DRILL: ["PLANNED", "DONE"],
  SOP_REVIEW: ["DUE", "REVIEWED"],
  BOARD_PACK: ["DRAFT", "FROZEN"],
  LEGAL_ENTITY: ["ACTIVE"],
  OBLIGATION: ["TODO", "FILED", "DONE"],
  COMMITTEE: ["ACTIVE", "CLOSED"],
  TERM: ["ACTIVE", "ENDED"],
  MINUTES: ["DRAFT", "APPROVED"],
  RESOLUTION: ["DRAFT", "PASSED", "REJECTED"],
  CONFLICT: ["DECLARED", "REVIEWED"],
  AGM_ITEM: ["TODO", "DONE"],
  VENDOR: ["ACTIVE", "INACTIVE"],
  CONTRACT: ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"],
};
export const label = (s: string) =>
  ({ TODO: "To do", AGM_ITEM: "AGM checklist item" })[s] ??
  s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const sectionFor = (kind: Kind): Section =>
  (Object.keys(SECTIONS) as Section[]).find((s) => SECTIONS[s].includes(kind))!;
export const sectionPath = (section: Section) =>
  section === "compliance" ? "" : `/${section}`;
export const dateOnly = z
  .string()
  .refine(
    (s) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      Number.isFinite(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Choose a valid date.",
  );
const optionalDate = z.union([dateOnly, z.literal("")]).default("");
const text = z.string().trim().max(300).default("");
const notes = z.string().trim().max(20000).default("");
const id = z
  .string()
  .max(64)
  .regex(/^[a-zA-Z0-9_-]*$/)
  .default("");
const pan = text.refine(
  (s) => !s || /^[A-Z]{5}\d{4}[A-Z]$/.test(s),
  "Check the PAN or leave it blank for an overseas entity.",
);
const gstin = text.refine(
  (s) => !s || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(s),
  "Check the GSTIN or leave it blank.",
);
const permitDetails = z.object({
  issuer: z.string().trim().min(1, "Enter the issuer.").max(300),
  reference: z.string().trim().min(1, "Enter the number.").max(300),
  scope: notes,
  sumInsuredMinor: z.number().int().min(0).max(2147483647).default(0),
  premiumFrequency: z.enum(["MONTHLY","QUARTERLY","YEARLY"]).default("YEARLY"),
  premiumMinor: z.number().int().min(0).max(2147483647).default(0),
  currency: z.string().refine(isValidCurrency, "Choose a currency."),
  obligationId: id,
});
export const detailSchemas = {
  INSURANCE: permitDetails,
  LICENCE: permitDetails,
  REGISTRATION: permitDetails,
  STATUTORY_REGISTER: z.object({
    entityId: z.string().min(1).max(64),
    registerType: z.enum(["MEMBERS", "DIRECTORS", "MINUTES", "OTHER"]),
    scope: notes,
  }),
  RISK: z.object({
    likelihood: z.number().int().min(1).max(5),
    impact: z.number().int().min(1).max(5),
    controls: z.string().trim().min(1, "Record the controls.").max(20000),
    assessment: notes,
  }),
  EMERGENCY_PLAN: z.object({
    docId: z.string().min(1, "Choose a document.").max(64),
    scope: notes,
  }),
  DRILL: z.object({
    planId: z.string().min(1, "Choose a plan.").max(64),
    findings: notes,
    actions: notes,
  }),
  SOP_REVIEW: z.object({
    docId: z.string().min(1, "Choose a document.").max(64),
    reviewNote: notes,
  }),
  BOARD_PACK: z.object({
    docIds: z.array(z.string().min(1).max(64)).max(30).default([]),
    decisionIds: z.array(z.string().min(1).max(64)).max(50).default([]),
    recordIds: z.array(z.string().min(1).max(64)).max(50).default([]),
    includeFinance: z.boolean().default(false),
    currency: z.string().refine(isValidCurrency).default("INR"),
  }),
  LEGAL_ENTITY: z.object({
    entityType: z.enum(["SECTION_8", "SOCIETY", "TRUST", "OTHER"]),
    registration: text,
    pan,
    tan: text.refine(
      (s) => !s || /^[A-Z]{4}\d{5}[A-Z]$/.test(s),
      "Check the TAN or leave it blank.",
    ),
    gstin,
    address: notes,
    otherIds: notes,
    fcra: text,
    charity12a: text,
    charity80g: text,
    csr1: text,
  }),
  OBLIGATION: z.object({
    recurrence: z.enum(["NONE", "MONTHLY", "QUARTERLY", "ANNUALLY"]),
    acknowledgement: text,
    applicability: text,
  }),
  COMMITTEE: z.object({
    committeeType: z.enum(["BOARD", "COMMITTEE"]),
    mandate: notes,
  }),
  TERM: z.object({
    position: text,
    person: z.string().trim().min(1, "Enter the member's name.").max(300),
    contactId: id,
  }),
  MINUTES: z.object({
    content: z.string().trim().min(1, "Add the minutes.").max(50000),
  }),
  RESOLUTION: z.object({
    content: z.string().trim().min(1, "Add the resolution text.").max(20000),
    outcome: notes,
  }),
  CONFLICT: z.object({
    person: z.string().trim().min(1, "Enter the declarant's name.").max(300),
    partyOrgId: id,
    partyName: text,
    declaration: z
      .string()
      .trim()
      .min(1, "Record the declaration, including when there is no conflict.")
      .max(20000),
    management: notes,
  }),
  AGM_ITEM: z.object({
    year: z.string().regex(/^\d{4}$/, "Enter a four digit year."),
  }),
  VENDOR: z.object({
    gstin,
    pan,
    overseasTaxId: text,
    email: z.union([z.email(), z.literal("")]).default(""),
    phone: text,
  }),
  CONTRACT: z.object({
    vendorId: z.string().min(1, "Choose a vendor.").max(64),
    amountMinor: z.number().int().min(0).max(2147483647),
    currency: z
      .string()
      .refine(isValidCurrency, "Enter a three-letter currency code."),
    noticeDays: z.number().int().min(0).max(3650),
    reference: text,
  }),
};
export const recordSchema = z
  .object({
    id,
    kind: z.enum(KINDS),
    title: z.string().trim().min(1, "Enter a name.").max(300),
    status: z.string().max(30),
    ownerId: id,
    parentId: id,
    organisationId: id,
    meetingId: id,
    dueOn: optionalDate,
    startsOn: optionalDate,
    endsOn: optionalDate,
    reminderDays: z.number().int().min(0).max(365).default(7),
    notes,
    details: z.record(z.string(), z.unknown()),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: path.split("."), message });
    if (!STATUSES[v.kind].includes(v.status))
      issue("status", "Choose a status for this record.");
    const parsed = detailSchemas[v.kind].safeParse(v.details);
    if (!parsed.success)
      for (const e of parsed.error.issues)
        ctx.addIssue({ ...e, path: ["details", ...e.path] });
    if (
      ["INSURANCE", "LICENCE", "REGISTRATION", "BOARD_PACK"].includes(v.kind) &&
      (!v.startsOn || !v.endsOn)
    )
      issue("endsOn", "Enter start and end dates.");
    if (
      [
        "STATUTORY_REGISTER",
        "RISK",
        "EMERGENCY_PLAN",
        "DRILL",
        "SOP_REVIEW",
      ].includes(v.kind) &&
      !v.dueOn
    )
      issue("dueOn", "Choose a review or drill date.");
    if (["OBLIGATION", "AGM_ITEM", "CONFLICT"].includes(v.kind) && !v.dueOn)
      issue("dueOn", "Choose a due date or declaration date.");
    if (["TERM", "CONTRACT"].includes(v.kind) && (!v.startsOn || !v.endsOn))
      issue("endsOn", "Enter start and end dates.");
    if (v.startsOn && v.endsOn && v.endsOn < v.startsOn)
      issue("endsOn", "End date must be on or after the start date.");
    if (
      ["TERM", "MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"].includes(
        v.kind,
      ) &&
      !v.parentId
    )
      issue("parentId", "Choose a board or committee.");
    if (
      !["TERM", "MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"].includes(
        v.kind,
      ) &&
      v.parentId
    )
      issue("parentId", "Only board records link a committee here.");
    if (v.kind === "MINUTES" && !v.meetingId)
      issue("meetingId", "Choose an existing meeting.");
    if (v.kind === "VENDOR" && !v.organisationId)
      issue("organisationId", "Choose an existing CRM organisation.");
    if (v.kind !== "VENDOR" && v.organisationId)
      issue("organisationId", "Only vendors link a CRM organisation here.");
    if (
      !["MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"].includes(v.kind) &&
      v.meetingId
    )
      issue("meetingId", "This record does not link a meeting.");
  });
export type RecordInput = z.infer<typeof recordSchema>;
export const bankSchema = z.object({
  vendorId: z.string().min(1).max(64),
  accountName: z.string().trim().min(1).max(300),
  bankName: z.string().trim().min(1).max(300),
  accountNumber: z.string().trim().min(1).max(100),
  routingCode: text,
  reason: z
    .string()
    .trim()
    .min(5, "Explain why the bank details changed.")
    .max(1000),
});
export const operationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.enum(["archive", "restore"]),
    id: z.string().min(1).max(64),
  }),
  z.object({ op: z.literal("approve"), id: z.string().min(1).max(64) }),
  z.object({ op: z.literal("next"), id: z.string().min(1).max(64) }),
  z.object({
    op: z.literal("agm"),
    parentId: z.string().min(1).max(64),
    year: z.string().regex(/^\d{4}$/),
    dueOn: dateOnly,
  }),
]);
export const AGM_ITEMS = [
  "Confirm the AGM date and notice",
  "Circulate agenda and previous minutes",
  "Prepare annual report and audited accounts",
  "Confirm quorum and member register",
  "Record elections and conflict declarations",
  "Approve minutes and file acknowledgements",
];

/** Recurrence is a manual next-occurrence action; retain the original proof and date. */
export function nextDate(value: string, recurrence: string): string | null {
  const months = { MONTHLY: 1, QUARTERLY: 3, ANNUALLY: 12 }[recurrence];
  if (!months || !dateOnly.safeParse(value).success) return null;
  const d = new Date(`${value}T12:00:00Z`),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${(/^[\s]*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
}
export function dayInZone(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
/** Search parameters as list filters; repeated keys are ignored. */
export function governanceFilters(
  params: Record<string, string | string[] | undefined>,
) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === "string" ? v : undefined,
    ]),
  );
}
