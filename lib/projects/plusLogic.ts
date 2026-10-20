import { z } from "zod";
import { DAY_MS, localDayNumber, localToInstant } from "@/lib/tasks/localDate";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const projectDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "1900-01-01" && s <= "9999-12-31";
}, "Choose a valid calendar date.");
export const milestoneSchema = z.object({
  projectId: id, id: id.optional(), name: z.string().trim().min(1).max(120), targetOn: projectDate,
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE"]), notes: z.string().trim().max(2000).default(""),
  taskIds: z.array(id).max(200).transform((ids) => [...new Set(ids)]),
});
export const removeMilestoneSchema = z.object({ projectId: id, id });
const lines = z.array(z.string().trim().min(1).max(500)).max(20);
export const statusUpdateSchema = z.object({
  projectId: id, status: z.enum(["ON_TRACK", "AT_RISK", "OFF_TRACK"]),
  note: z.string().trim().min(1, "Write a short update.").max(2000), blockers: lines, nextSteps: lines,
});
export const taskPlanSchema = z.object({
  taskId: id, startsOn: projectDate.nullable(), blockerReason: z.string().trim().max(1000), blockerOwnerId: id.nullable(),
}).refine((v) => !v.blockerReason || v.blockerOwnerId, { message: "Choose someone to follow up on this blocker.", path: ["blockerOwnerId"] });

export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type StatusUpdateInput = z.infer<typeof statusUpdateSchema>;
export const HEALTH_LABELS: Record<string, string> = { ON_TRACK: "On track", AT_RISK: "At risk", OFF_TRACK: "Off track" };
export const MILESTONE_LABELS: Record<string, string> = { PENDING: "Not started", IN_PROGRESS: "In progress", DONE: "Done" };
export function milestoneStatus(status: string, tasks: Array<{ completedAt: unknown }>): string {
  return status === "DONE" || (tasks.length > 0 && tasks.every((t) => Boolean(t.completedAt))) ? "DONE" : status;
}
export function projectProgress(tasks: Array<{ parentId: string | null; completedAt: unknown }>) {
  const roots = tasks.filter(t => !t.parentId);
  const done = roots.filter(t => Boolean(t.completedAt)).length;
  return { total: roots.length, done, percent: roots.length ? Math.round(done * 100 / roots.length) : 0 };
}
export function nextUpdateDue(anchor: Date, timeZone: string) {
  return localToInstant(localDayNumber(anchor, timeZone) + 7, 9, 0, timeZone);
}
/** Inclusive schedule span; one dated endpoint is shown as a single day. */
export function timelineRange(rows: Array<{ start: string | null; end: string | null }>) {
  const dates = rows.flatMap(r => [r.start, r.end]).filter((d): d is string => Boolean(d)).sort();
  const start = dates[0]; const end = dates.at(-1);
  return start && end ? { start, end, days: Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1) } : null;
}
export function timelinePosition(start: string | null, end: string | null, range: NonNullable<ReturnType<typeof timelineRange>>) {
  const a = start ?? end ?? range.start; const b = end ?? start ?? range.start;
  const offset = Math.max(0, (Date.parse(a) - Date.parse(range.start)) / DAY_MS);
  const days = Math.max(1, (Date.parse(b) - Date.parse(a)) / DAY_MS + 1);
  return { left: `${100 * offset / range.days}%`, width: `${Math.min(100 - 100 * offset / range.days, 100 * days / range.days)}%` };
}
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
