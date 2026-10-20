import { z } from "zod";
import { isValidCurrency } from "@/lib/format/money";
export const KINDS = ["CONTENT", "BRAND", "PROPOSAL", "DEVICE", "LICENCE", "INCIDENT", "REVIEW", "RESTORE"] as const;
export type Kind = typeof KINDS[number];
export const MARKETING: Kind[] = ["CONTENT", "BRAND", "PROPOSAL"];
export const LABELS: Record<Kind, string> = { CONTENT: "Content calendar", BRAND: "Brand assets", PROPOSAL: "Proposals and outreach", DEVICE: "Devices", LICENCE: "Software licences", INCIDENT: "Security incidents", REVIEW: "Access reviews", RESTORE: "Backups and recovery" };
export const STATUSES: Record<Kind, string[]> = { CONTENT: ["IDEA", "DRAFT", "REVIEW", "SCHEDULED", "PUBLISHED"], BRAND: ["DRAFT", "APPROVED", "RETIRED"], PROPOSAL: ["DRAFT", "SENT", "FOLLOW_UP", "WON", "DECLINED", "WITHDRAWN"], DEVICE: ["IN_STOCK", "ASSIGNED", "REPAIR", "LOST", "RETURNED", "RETIRED"], LICENCE: ["ACTIVE", "PAUSED", "RETIRED"], INCIDENT: ["DETECTED", "CONTAINED", "RESOLVED"], REVIEW: ["OPEN", "COMPLETED"], RESTORE: ["PLANNED", "PASSED", "FAILED"] };
export const id = z.string().trim().max(100);
const ref = id.default("");
const text = z.string().trim().max(10000).default("");
const short = z.string().trim().max(300).default("");
export const date = z.union([z.literal(""), z.iso.date()]).default("");
const instant = z.union([z.literal(""), z.iso.datetime({ offset: true })]).default("");
export const CHANNELS = ["INSTAGRAM", "LINKEDIN", "X", "YOUTUBE", "FACEBOOK", "NEWSLETTER", "WEBSITE", "NEWS_POST"] as const;
export const detailSchemas = {
 CONTENT: z.object({ channel: z.enum(CHANNELS).default("INSTAGRAM"), publishAt: instant, caption: text, socialPostId: ref }),
 BRAND: z.object({ category: z.enum(["LOGO", "COLOUR", "TYPE", "TEMPLATE", "PHOTO"]).default("LOGO"), tags: short, usage: text, reference: text }),
 PROPOSAL: z.object({ organisationId: ref, contactId: ref, dealId: ref, fundingId: ref, amountMinor: z.number().int().min(0).max(2147483647).default(0), currency: z.string().toUpperCase().refine(isValidCurrency).default("INR"), sentOn: date, outcome: text }),
 DEVICE: z.object({ deviceType: z.enum(["LAPTOP", "PHONE", "ROUTER", "DESKTOP", "TABLET", "OTHER"]).default("LAPTOP"), serial: short, purchasedOn: date, warrantyOn: date, condition: short, handoverNote: text }),
 LICENCE: z.object({ seats: z.number().int().min(1).max(100000), assigneeIds: z.array(z.string().min(1).max(100)).max(1000).default([]) }),
 INCIDENT: z.object({ type: z.enum(["PHISHING", "LOST_DEVICE", "ACCOUNT_COMPROMISE", "DATA_EXPOSURE", "OTHER"]).default("PHISHING"), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"), confidential: z.boolean().default(true), detectedAt: instant, containedAt: instant, resolvedAt: instant, deviceId: ref, accountId: ref, integrationId: ref, serviceIncidentId: ref, actions: text, lessons: text }),
 REVIEW: z.object({ cadence: z.enum(["MONTHLY", "QUARTERLY"]).default("QUARTERLY") }),
 RESTORE: z.object({ result: text, runbookDocId: ref, backupRunId: ref }),
} as const;
export const recordSchema = z.object({ id: ref, kind: z.enum(KINDS), title: z.string().trim().min(1, "Add a title.").max(200), status: z.string().max(30), ownerId: ref, assetId: ref, subscriptionId: ref, dateOn: date, dueOn: date, reminderDays: z.number().int().min(0).max(90).default(1), notes: text, details: z.unknown() }).superRefine((row, ctx) => {
 const issue = (message: string) => ctx.addIssue({ code: "custom", message });
 if (!STATUSES[row.kind].includes(row.status)) issue("Choose a valid status.");
 const parsed = detailSchemas[row.kind].safeParse(row.details);
 if (!parsed.success) { for (const e of parsed.error.issues) ctx.addIssue({ ...e, path: ["details", ...e.path] }); return; }
 const d = parsed.data;
 if (row.kind === "DEVICE" && !row.assetId) issue("Choose an existing asset.");
 if (row.kind === "DEVICE" && row.status === "ASSIGNED" && !row.ownerId) issue("Choose the person holding this device.");
 if (row.kind === "DEVICE" && ["IN_STOCK", "RETURNED", "RETIRED"].includes(row.status) && row.ownerId) issue("Clear the assignee when returning this device.");
 if (row.kind === "LICENCE" && !row.subscriptionId) issue("Choose an existing licence subscription.");
 if (row.kind === "LICENCE" && "assigneeIds" in d && (new Set(d.assigneeIds).size !== d.assigneeIds.length || d.assigneeIds.length > d.seats)) issue("Choose distinct people within the available seat count.");
 if (row.kind === "CONTENT" && ["SCHEDULED", "PUBLISHED"].includes(row.status) && "publishAt" in d && !d.publishAt) issue("Choose the publish date and time.");
 if (row.kind === "PROPOSAL" && "organisationId" in d) { if (!d.organisationId && !d.contactId) issue("Choose an organisation or contact."); if (["SENT", "FOLLOW_UP", "WON", "DECLINED"].includes(row.status) && !d.sentOn) issue("Add the sent date."); }
 if (row.kind === "REVIEW" && !row.dueOn) issue("Choose a review due date.");
 if (row.kind === "RESTORE" && (!row.dateOn || !row.dueOn)) issue("Add the test date and next test date.");
 if (row.kind === "RESTORE" && row.dateOn && row.dueOn <= row.dateOn) issue("The next test must follow this test date.");
 if (row.kind === "INCIDENT" && "detectedAt" in d) {
  if (!d.detectedAt) issue("Add the detection time.");
  if (row.status !== "DETECTED" && !d.containedAt) issue("Add the containment time.");
  if (row.status === "RESOLVED" && (!d.resolvedAt || !d.actions || !d.lessons)) issue("Add resolution time, actions and lessons before resolving.");
  if ((d.containedAt && Date.parse(d.containedAt) < Date.parse(d.detectedAt)) || (d.resolvedAt && Date.parse(d.resolvedAt) < Date.parse(d.containedAt || d.detectedAt))) issue("Incident times must follow detection, containment and resolution order.");
 }
});
export type RecordInput = z.input<typeof recordSchema>;
export function human(s: string) { return s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " "); }
export function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function isMarketing(kind: string) { return MARKETING.includes(kind as Kind); }
export function section(kind: string) { return isMarketing(kind) ? "marketing" : "it"; }
export function path(slug: string, kind: string) { return `/w/${slug}/${section(kind)}?tool=${kind}`; }
export function dayInZone(now: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function calendarDays(anchor: string, view: string) {
 const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(anchor) && !Number.isNaN(Date.parse(anchor)) ? anchor : "2026-10-01");
 if (view === "month") start.setUTCDate(1);
 start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
 return Array.from({ length: view === "week" ? 7 : 42 }, (_, index) => new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10));
}
export function csv(rows: unknown[][]) { return "\uFEFF" + rows.map(row => row.map(value => { const s = String(value ?? ""); return '"' + (/^\s*[=+@-]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'; }).join(",")).join("\r\n"); }
