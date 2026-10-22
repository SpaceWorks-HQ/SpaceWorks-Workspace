import { z } from "zod";
import type { HelpTicketPriority, HelpTicketStatus } from "@prisma/client";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";

export const id = z.string().min(1).max(100);
export const title = z.string().trim().min(1, "Enter a title.").max(160, "Keep the title within 160 characters.");
export const body = z.string().trim().min(1, "Add some details.").max(5000, "Keep details within 5,000 characters.");
export const optionalText = z.string().trim().max(2000).default("");
export const requestKey = z.string().uuid("Refresh the page and try again.");
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, "Choose a valid date.");
export const CATEGORIES = ["IT support", "Facilities", "Admin", "Finance", "HR", "Confidential", "Other"] as const;
export const SLA_HOURS: Record<HelpTicketPriority, number> = { URGENT: 4, HIGH: 24, NORMAL: 72, LOW: 168 };
export function ticketDueAt(priority: HelpTicketPriority, now: Date) { return new Date(now.getTime() + SLA_HOURS[priority] * 3600000); }
const transitions: Record<HelpTicketStatus, HelpTicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["OPEN", "WAITING", "RESOLVED", "CLOSED"],
  WAITING: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"], CLOSED: ["OPEN"],
};
export function canTransitionTicket(from: HelpTicketStatus, to: HelpTicketStatus) { return from === to || transitions[from].includes(to); }
export function localDay(now: Date, zone: string) { return zonedDatetimeLocalValue(now, zone).slice(0, 10); }
export function addDays(date: string, days: number) { return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0,10); }
/** Keep the original cadence, skip missed dates after downtime, never duplicate a run. */
export function nextChecklistDay(due: string, cadenceDays: number, today: string) {
  const elapsed = Math.max(0, Math.floor((Date.parse(today) - Date.parse(due)) / 86400000));
  return addDays(due, (Math.floor(elapsed / cadenceDays) + 1) * cadenceDays);
}
export function workedMinutes(startsAt: Date, endsAt: Date, breakMinutes: number) {
  const elapsed = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (!Number.isInteger(elapsed) || elapsed <= 0 || elapsed > 16 * 60 || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= elapsed) return null;
  return elapsed - breakMinutes;
}
export function durationLabel(minutes: number) { return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; }
export function label(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase()); }
export function pageNumber(value: unknown) { const n=Number(value); return Number.isInteger(n) && n > 0 ? Math.min(n,10000) : 1; }

export const ENGAGEMENT_TYPES = ["STAFF", "VOLUNTEER", "CONTRACTOR"] as const;
export const CANDIDATE_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "DECLINED", "WITHDRAWN"] as const;
export function leaveDays(from: string, to: string) { return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1; }
/** Neutralise spreadsheet formulas, including whitespace-prefixed values. */
export function csvCell(value: unknown) { const text = value instanceof Date ? value.toISOString() : String(value ?? ""); return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"'; }
export function csvText(rows: unknown[][]) { return rows.map(row => row.map(csvCell).join(",")).join("\r\n"); }

/** Cumulative rounding preserves the exact total when a log spans month boundaries. */
export function allocatedMinutes(total: number, start: Date, end: Date, from: Date, to: Date) {
  const elapsed=end.getTime()-start.getTime(); if(elapsed<=0)return 0;
  const lower=Math.max(0,Math.min(elapsed,from.getTime()-start.getTime()));
  const upper=Math.max(0,Math.min(elapsed,to.getTime()-start.getTime()));
  return Math.max(0,Math.round(total*upper/elapsed)-Math.round(total*lower/elapsed));
}
