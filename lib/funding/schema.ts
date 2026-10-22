import { z } from "zod";
import { isValidCurrency } from "@/lib/format/money";

export const KINDS = ["OPPORTUNITY", "FUNDER", "GRANT", "INSTALMENT", "REPORT", "DELIVERABLE", "DONATION", "CAMPAIGN", "PLEDGE", "DONOR", "PROGRAMME", "KPI", "IMPACT_ENTRY", "RUNWAY", "TOOL_ACCOUNT", "ACCESS_REVIEW", "RECEIPT_SETTINGS"] as const;
export type Kind = typeof KINDS[number];
export const SECTIONS = ["tracker", "grants", "donations", "impact", "runway", "access"] as const;
export type Section = typeof SECTIONS[number];
export const SECTION_KINDS: Record<Section, Kind[]> = {
  tracker: ["OPPORTUNITY"], grants: ["GRANT", "FUNDER", "INSTALMENT", "REPORT", "DELIVERABLE"],
  donations: ["DONATION", "CAMPAIGN", "PLEDGE", "DONOR", "RECEIPT_SETTINGS"], impact: ["PROGRAMME", "KPI", "IMPACT_ENTRY"],
  runway: ["RUNWAY"], access: ["TOOL_ACCOUNT", "ACCESS_REVIEW"],
};
export function sectionFor(kind: Kind): Section { return SECTIONS.find(section => SECTION_KINDS[section].includes(kind))!; }
export const LABELS: Record<Kind, string> = {
  OPPORTUNITY: "Funding opportunity", FUNDER: "Funder profile", GRANT: "Grant", INSTALMENT: "Grant instalment", REPORT: "Grant report", DELIVERABLE: "Deliverable", DONATION: "Donation", CAMPAIGN: "Campaign", PLEDGE: "Recurring gift or pledge", DONOR: "Donor profile", PROGRAMME: "Programme", KPI: "KPI", IMPACT_ENTRY: "Impact entry", RUNWAY: "Monthly cash forecast", TOOL_ACCOUNT: "Tool account", ACCESS_REVIEW: "Access review", RECEIPT_SETTINGS: "Receipt details",
};
export const STAGES = ["IDEA", "APPLYING", "SUBMITTED", "AWARDED", "DECLINED", "RECEIVING", "REPORTING", "CLOSED"] as const;
export const STATUSES: Record<Kind, readonly string[]> = {
  OPPORTUNITY: STAGES, FUNDER: ["ACTIVE", "INACTIVE"], GRANT: ["ACTIVE", "REPORTING", "CLOSED"], INSTALMENT: ["EXPECTED", "RECEIVED", "CANCELLED"], REPORT: ["TODO", "SUBMITTED", "DONE"], DELIVERABLE: ["TODO", "DONE"], DONATION: ["RECEIVED", "VOID"], CAMPAIGN: ["PLANNED", "ACTIVE", "CLOSED"], PLEDGE: ["ACTIVE", "PAUSED", "COMPLETED"], DONOR: ["ACTIVE", "INACTIVE"], PROGRAMME: ["PLANNED", "ACTIVE", "CLOSED"], KPI: ["ACTIVE", "CLOSED"], IMPACT_ENTRY: ["RECORDED"], RUNWAY: ["FORECAST", "ACTUAL"], TOOL_ACCOUNT: ["ACTIVE", "REVOKE", "REMOVED"], ACCESS_REVIEW: ["TODO", "SIGNED"], RECEIPT_SETTINGS: ["ACTIVE"],
};
export const id = z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/);
const text = z.string().trim().max(2000).default("");
export const date = z.string().refine(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "Choose a valid calendar date.");
const optionalDate = z.union([date, z.literal("")]).default("");
export const minor = z.number().int().min(0).max(2147483647);
const money = minor.default(0);
const pan = z.string().trim().toUpperCase().max(10).refine(s => !s || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s), "Enter a valid PAN or leave it blank.").default("");
const email = z.union([z.email().max(320), z.literal("")]).default("");
const ref = id.default("");
const bool = z.boolean().default(false);
export const detailSchemas = {
  OPPORTUNITY: z.object({ source: z.enum(["GRANT", "CSR", "SPONSORSHIP", "MAJOR_DONOR", "GOVERNMENT", "CROWDFUNDING", "OTHER"]).default("GRANT"), askedMinor: money, awardedMinor: money, receivedMinor: money, applicationOn: optionalDate, reportOn: optionalDate, utilisationOn: optionalDate, nextAction: text, grantId: ref, programmeId: ref, donationId: ref, year: z.number().int().min(2000).max(2200) }),
  FUNDER: z.object({ focus: text, restrictions: text, csrRegistration: text }),
  GRANT: z.object({ purpose: text, restrictions: text, programmeId: ref, opportunityId: ref }),
  INSTALMENT: z.object({ receivedOn: optionalDate, reference: text }),
  REPORT: z.object({ reportType: z.enum(["PROGRESS", "FINAL", "UTILISATION", "OTHER"]).default("PROGRESS"), submittedOn: optionalDate }),
  DELIVERABLE: z.object({ completedOn: optionalDate }),
  DONATION: z.object({ mode: z.enum(["UPI", "BANK", "CASH", "CHEQUE", "CARD", "IN_KIND", "OTHER"]).default("BANK"), pan, donorAddress: text, foreignSource: bool, receiptNumber: z.string().trim().max(60).default(""), receiptIssued: bool, campaignId: ref, pledgeId: ref, grantId: ref, programmeId: ref, opportunityId: ref, inKindItem: text, receiptNote: text, donationType: z.enum(["CORPUS", "SPECIFIC", "OTHER"]).default("OTHER"), reference: text }),
  CAMPAIGN: z.object({ purpose: text, programmeId: ref }),
  PLEDGE: z.object({ frequency: z.enum(["ONCE", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"), campaignId: ref, nextExpectedOn: date, endOn: optionalDate }),
  DONOR: z.object({ pan, address: text }),
  PROGRAMME: z.object({ purpose: text }),
  KPI: z.object({ target: z.number().finite().positive().max(1e12), unit: z.string().trim().min(1).max(80), aggregation: z.enum(["SUM", "LATEST"]).default("SUM") }),
  IMPACT_ENTRY: z.object({ value: z.number().finite().min(0).max(1e12), period: z.string().trim().min(1).max(120) }),
  RUNWAY: z.object({ incomeMinor: money, expensesMinor: money }),
  TOOL_ACCOUNT: z.object({ userId: id.min(1), serviceId: ref, subscriptionId: ref, identity: z.string().trim().min(1).max(200), accessLevel: z.string().trim().max(120).default("Member") }),
  ACCESS_REVIEW: z.object({ quarter: z.string().regex(/^20\d{2}-Q[1-4]$/), decision: z.enum(["KEEP", "CHANGE", "REMOVE"]).default("KEEP"), reviewNote: text }),
  RECEIPT_SETTINGS: z.object({ organisationName: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(2000), pan: pan.refine(s => s.length > 0, "Enter the organisation PAN."), registration12A: text, registration80G: z.string().trim().min(1).max(200), registrationFCRA: text, receiptPrefix: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9/-]+$/), signatory: z.string().trim().min(1).max(120), email }),
} as const;
export const recordSchema = z.object({
  id: ref, kind: z.enum(KINDS), title: z.string().trim().min(1, "Add a name.").max(200), status: z.string().max(30), ownerId: ref,
  parentId: ref, fundId: ref, contactId: ref, organisationId: ref, dateOn: optionalDate, dueOn: optionalDate, endsOn: optionalDate,
  amountMinor: money, currency: z.string().toUpperCase().refine(isValidCurrency, "Choose a valid currency."), notes: z.string().trim().max(10000).default(""),
  reminderDays: z.number().int().min(0).max(90).default(7), details: z.unknown(),
}).superRefine((row, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (!STATUSES[row.kind].includes(row.status)) issue("status", "Choose a valid status.");
  if (row.dateOn && row.endsOn && row.endsOn < row.dateOn) issue("endsOn", "The end must follow the start.");
  if (["DONATION", "PLEDGE", "DONOR"].includes(row.kind) && !row.contactId) issue("contactId", "Choose an existing CRM contact.");
  if (["FUNDER", "GRANT"].includes(row.kind) && !row.organisationId) issue("organisationId", "Choose an existing CRM organisation.");
  if (["INSTALMENT", "REPORT", "DELIVERABLE", "KPI", "IMPACT_ENTRY", "ACCESS_REVIEW"].includes(row.kind) && !row.parentId) issue("parentId", "Choose the linked record.");
  if (["DONATION", "RUNWAY", "IMPACT_ENTRY", "GRANT", "CAMPAIGN"].includes(row.kind) && !row.dateOn) issue("dateOn", "Choose a date.");
  if (["INSTALMENT", "REPORT", "DELIVERABLE", "ACCESS_REVIEW"].includes(row.kind) && !row.dueOn) issue("dueOn", "Choose a due date.");
  if (["GRANT", "CAMPAIGN"].includes(row.kind) && !row.endsOn) issue("endsOn", "Choose an end date.");
  if (["DONATION", "PLEDGE", "GRANT", "INSTALMENT", "CAMPAIGN"].includes(row.kind) && !row.amountMinor) issue("amountMinor", "Enter a positive amount.");
  const details = detailSchemas[row.kind].safeParse(row.details);
  if (!details.success) for (const e of details.error.issues) ctx.addIssue({ ...e, path: ["details", ...e.path] });
  if (row.kind === "DONATION" && details.success && "mode" in details.data && details.data.mode === "IN_KIND" && !details.data.inKindItem) issue("details.inKindItem", "Describe the donated item.");
  if (row.kind === "INSTALMENT" && row.status === "RECEIVED" && details.success && "receivedOn" in details.data && !details.data.receivedOn) issue("details.receivedOn", "Add the date received.");
});
export const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.enum(["archive", "restore", "thank", "sign", "receipt", "email", "void", "impactPdf"]), id: id.min(1) }),
  z.object({ op: z.literal("quarter"), quarter: z.string().regex(/^20\d{2}-Q[1-4]$/) }),
  z.object({ op: z.literal("donorPreferences"), id: id.min(1), preferredChannel: z.enum(["EMAIL", "PHONE", "POST", "NONE"]), consentStatus: z.enum(["GRANTED", "DENIED", "UNKNOWN"]), doNotContact: z.boolean(), consentSource: z.string().trim().max(200) }),
]);
export function dayInZone(now: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function advanceDate(value: string, months: number) {
  const source = new Date(value); const last = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months + 1, 0));
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(source.getUTCDate(), last.getUTCDate()))).toISOString().slice(0, 10);
}
export function quarterEnd(quarter: string) { const [year, q] = quarter.split("-Q").map(Number); return new Date(Date.UTC(year!, q! * 3, 0)).toISOString().slice(0, 10); }
export function human(value: string) { return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " "); }
export function csv(rows: unknown[][]) { return "\uFEFF" + rows.map(row => row.map(value => { const text = String(value ?? ""); return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"'; }).join(",")).join("\r\n"); }
