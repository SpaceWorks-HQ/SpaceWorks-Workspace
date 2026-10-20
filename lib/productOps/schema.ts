import { z } from "zod";
export const KINDS = ["ROADMAP", "RELEASE", "ISSUE", "QA_RUN", "ESTIMATE", "PROTOTYPE", "TEST", "CHANGE"] as const;
export type Kind = typeof KINDS[number];
export const SECTIONS = ["roadmap", "releases", "issues", "estimates", "prototypes", "changes", "ownership"] as const;
export type Section = typeof SECTIONS[number];
export const SECTION_KINDS: Record<Section, Kind[]> = { roadmap: ["ROADMAP"], releases: ["RELEASE", "QA_RUN"], issues: ["ISSUE"], estimates: ["ESTIMATE"], prototypes: ["PROTOTYPE", "TEST"], changes: ["CHANGE"], ownership: [] };
export const LABELS: Record<Section, string> = { roadmap: "Roadmap", releases: "Release planning", issues: "Issues and QA", estimates: "BOM estimates", prototypes: "Prototypes and tests", changes: "Deployment and changes", ownership: "Technical ownership" };
export const STATUSES: Record<Kind, readonly string[]> = { ROADMAP: ["PLANNED", "IN_PROGRESS", "DONE"], RELEASE: ["DRAFT", "IN_REVIEW", "SHIPPED"], ISSUE: ["OPEN", "TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"], QA_RUN: ["OPEN", "PASSED", "FAILED"], ESTIMATE: ["DRAFT", "READY"], PROTOTYPE: ["PLANNED", "BUILDING", "TESTING", "COMPLETE"], TEST: ["PLANNED", "PASS", "FAIL"], CHANGE: ["PLANNED", "IN_REVIEW", "APPLIED", "ROLLED_BACK"] };
export const CATEGORIES = ["ELECTRICAL", "STRUCTURAL", "ELECTRONICS", "SOFTWARE", "SERVICES", "LABOUR", "OTHER"] as const;
export const id = z.string().trim().max(64).regex(/^[a-zA-Z0-9_-]*$/);
const optionalId = id.default("");
const text = z.string().trim().max(6000).default("");
const short = z.string().trim().max(250).default("");
const date = z.union([z.literal(""), z.iso.date()]).default("");
const webUrl = z.union([z.literal(""), z.url().max(2000).refine(value => /^https?:\/\//.test(value), "Use an http or https link.")]).default("");
export const checklist = z.array(z.object({ title: z.string().trim().min(1).max(200), done: z.boolean().default(false), note: z.string().trim().max(1000).default("") })).max(100).default([]);
export const lineSchema = z.object({ item: z.string().trim().min(1).max(200), specification: short, category: z.enum(CATEGORIES).default("OTHER"), quantityMilli: z.number().int().min(1).max(100000000), unit: z.string().trim().min(1).max(40).default("each"), unitCostMinor: z.number().int().min(0).max(100000000000), supplier: short, quoteUrl: webUrl, quoteFileId: optionalId, gstBps: z.number().int().min(0).max(10000).default(0) });
export type EstimateLine = z.infer<typeof lineSchema>;
export const estimateSchema = z.object({ lines: z.array(lineSchema).min(1).max(200), contingencyBps: z.number().int().min(0).max(10000).default(1000), revisionNote: z.string().trim().min(1).max(1000) });
export type EstimateDetails = z.infer<typeof estimateSchema>;
export const detailSchemas = {
 ROADMAP: z.object({ horizon: z.enum(["NOW", "NEXT", "LATER"]).default("NEXT"), quarter: z.union([z.literal(""), z.string().regex(/^20\d{2}-Q[1-4]$/)]).default(""), ideaId: optionalId, outcome: text }),
 RELEASE: z.object({ repoId: optionalId, githubEventId: optionalId, version: z.string().trim().min(1).max(80), scope: text, taskIds: z.array(id.min(1)).max(100).default([]), roadmapIds: z.array(id.min(1)).max(100).default([]), checklist, releaseNotes: text }),
 ISSUE: z.object({ type: z.enum(["BUG", "FEATURE_REQUEST", "QA_CHECK"]).default("BUG"), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"), steps: text, expected: text, environment: short, ideaId: optionalId }),
 QA_RUN: z.object({ environment: short, checklist: checklist.refine(items => items.length > 0, "Add at least one QA check."), findings: text }),
 ESTIMATE: estimateSchema,
 PROTOTYPE: z.object({ version: z.string().trim().min(1).max(80), designRevision: text }),
 TEST: z.object({ testPlan: z.string().trim().min(1).max(6000), results: text, findings: text, designRevision: text }),
 CHANGE: z.object({ environment: z.string().trim().min(1).max(250), changed: z.string().trim().min(1).max(6000), risk: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"), rollback: z.string().trim().min(1).max(6000), incidentId: optionalId, requiresApproval: z.boolean().default(false) }),
};
export const recordSchema = z.object({ id: optionalId, kind: z.enum(KINDS), title: z.string().trim().min(1).max(200), status: z.string().max(30), ownerId: optionalId, projectId: optionalId, releaseId: optionalId, parentId: optionalId, fundingId: optionalId, budgetId: optionalId, fundId: optionalId, dueOn: date, dateOn: date, reminderDays: z.number().int().min(0).max(90).default(7), currency: z.string().regex(/^[A-Z]{3}$/).default("INR"), notes: text, details: z.unknown(), revision: z.number().int().min(0).default(0) }).superRefine((value, ctx) => {
 if (!STATUSES[value.kind].includes(value.status)) ctx.addIssue({ code: "custom", path: ["status"], message: "Choose a status for this tool." });
 if (value.kind === "QA_RUN" && !value.releaseId) ctx.addIssue({ code: "custom", path: ["releaseId"], message: "Choose a release." });
 if (value.kind === "TEST" && (!value.parentId || !value.dateOn)) ctx.addIssue({ code: "custom", path: ["parentId"], message: "Choose a prototype and test date." });
 if (value.kind === "RELEASE" && (!value.ownerId || !value.dueOn)) ctx.addIssue({ code: "custom", path: ["ownerId"], message: "Choose a technical owner and target date." });
 if (value.kind === "ESTIMATE" && !value.projectId && !value.fundingId) ctx.addIssue({ code: "custom", path: ["projectId"], message: "Link a project or funding application." });
});
export type RecordInput = z.input<typeof recordSchema>;
export const operationSchema = z.object({ id: id.min(1), op: z.enum(["archive", "restore", "requestApproval", "withdraw", "ship", "apply", "rollback", "pdf"]), publish: z.boolean().default(false), version: z.number().int().min(1).optional() });
export const sectionFor = (kind: Kind): Section => SECTIONS.find(s => SECTION_KINDS[s].includes(kind))!;
export const human = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
export function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function csv(rows: unknown[][]) { return "\uFEFF" + rows.map(row => row.map(value => { const text = String(value ?? ""); return '"' + (/^\s*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"'; }).join(",")).join("\r\n"); }
