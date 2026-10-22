import { z } from "zod";
import { parseDayKey, addDays } from "@/lib/community/schedule";
export const id = z.string().min(1).max(100);
const optionalId = z.string().max(100).default("").transform(v => v || null);
const text = (max: number) => z.string().trim().max(max).default("");
export const day = z.string().refine(v => Boolean(parseDayKey(v)), "Choose a valid date.");
export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "HALF_DAY", "REMOTE", "ON_LEAVE"] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
export const STATUS_LABELS: Record<AttendanceStatus, string> = { PRESENT: "Present", ABSENT: "Absent", HALF_DAY: "Half-day", REMOTE: "Remote", ON_LEAVE: "On leave" };
export const departmentSchema = z.object({ id: optionalId, name: z.string().trim().min(1).max(120), headId: optionalId, parentId: optionalId, notes: text(2000) });
export const reportingSchema = z.object({ userId: id, departmentId: optionalId, managerId: optionalId });
const ids = z.array(id).max(100).default([]).transform(v => [...new Set(v)]);
export const responsibilitySchema = z.object({ id: optionalId, title: z.string().trim().min(1).max(160), status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).default("ACTIVE"), responsibleIds: ids.refine(v => v.length > 0, "Choose at least one responsible person."), accountableId: id, consultedIds: ids, informedIds: ids, backupId: optionalId, reviewOn: day, reminderDays: z.coerce.number().int().min(0).max(90).default(7), notes: text(5000) });
export const attendanceSchema = z.object({ userId: id, dateOn: day, status: z.enum(ATTENDANCE_STATUSES), notes: text(2000), version: z.string().max(40).default("") });
export const stepSchema = z.object({ userId: id, hours: z.enum(["IN_HOURS", "OUT_OF_HOURS", "ANY_TIME"]), instruction: text(300) });
export type EscalationStep = z.infer<typeof stepSchema>;
export const escalationSchema = z.object({ id: optionalId, title: z.string().trim().min(1).max(160), hoursNote: text(300), notes: text(2000), active: z.boolean().default(true), steps: z.array(stepSchema).min(1).max(20) });
export function monthDays(month: string): string[] {
  if (!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const start = `${month}-01`; const days: string[] = [];
  for (let key = start; key.startsWith(month); key = addDays(key, 1)) days.push(key);
  return days;
}
/** Reject a changed edge that would make a cycle, including pre-existing corrupt ancestry. */
export function wouldCycle(edges: readonly { id: string; parentId: string | null }[], id: string, parentId: string | null) {
  const byId = new Map(edges.map(e => [e.id, e.parentId])); const seen = new Set([id]);
  for (let next = parentId; next; next = byId.get(next) ?? null) { if (seen.has(next)) return true; seen.add(next); }
  return false;
}
export function indentedTree<T extends { id: string; parentId: string | null }>(rows: readonly T[]) {
  const result: Array<{ row: T; depth: number }> = []; const visited = new Set<string>();
  function walk(row: T, depth: number) { if (visited.has(row.id)) return; visited.add(row.id); result.push({ row, depth }); for (const child of rows.filter(v => v.parentId === row.id)) walk(child, depth + 1); }
  for (const row of rows.filter(r => !r.parentId || !rows.some(v => v.id === r.parentId))) walk(row, 0);
  for (const row of rows) if (!visited.has(row.id)) walk(row, 0);
  return result;
}
export const responsibilityRoles = (r: { responsibleIds: string[]; accountableId: string; consultedIds: string[]; informedIds: string[]; backupId: string | null }, userId: string) => [r.responsibleIds.includes(userId) ? "Responsible" : "", r.accountableId === userId ? "Accountable" : "", r.consultedIds.includes(userId) ? "Consulted" : "", r.informedIds.includes(userId) ? "Informed" : "", r.backupId === userId ? "Backup" : ""].filter(Boolean);
export function csvCell(value: unknown) { const text = String(value ?? ""); return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; }
