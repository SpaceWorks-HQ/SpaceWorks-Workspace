import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { dispatch } from "@/lib/notify/dispatch";
import { canManageMembers } from "@/lib/roles";
import { idSchema } from "@/lib/validation";
import { parseDayKey } from "@/lib/community/schedule";
import { dayRange } from "./availability";
import { adminIds, type PeopleActor } from "./context";

// Pending requests use CUSTOM checklists; only approval creates an Availability row.
export const timeOffSchema = z.object({ from: z.string().refine(v => Boolean(parseDayKey(v)), "Pick a start day."), to: z.string().refine(v => Boolean(parseDayKey(v)), "Pick an end day."), type: z.enum(["AWAY", "LIMITED", "TRAVEL", "BUSY"]).default("AWAY"), note: z.string().trim().max(200).default(""), visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE") }).refine(v => v.to >= v.from, { path: ["to"], message: "Pick an end day after the start." });
export async function requestTimeOff(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = timeOffSchema.safeParse(input); if (!p.success) return validationError(p.error);
  const range = dayRange(p.data.from, p.data.to, actor.workspace.timezone);
  if (range.endsAt.getTime() - range.startsAt.getTime() > 366 * 86400000) return actionError("Keep a request within a year.");
  await prisma.$transaction(async tx => {
    const run = await tx.checklistRun.create({ data: { workspaceId: actor.workspace.id, kind: "CUSTOM", title: `Time off: ${p.data.from} to ${p.data.to}`, subjectUserId: actor.user.id, createdById: actor.user.id, items: { create: { title: "Approve time off", descriptionMd: JSON.stringify(p.data), sourceType: "availability_request", assigneeId: (await adminIds(actor.workspace.id, tx))[0] ?? null } } } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.time_off_requested", targetType: "ChecklistRun", targetId: run.id });
  });
  return { ok: true };
}
export async function timeOffRequests(actor: PeopleActor) {
  const rows = await prisma.checklistRun.findMany({ where: { workspaceId: actor.workspace.id, items: { some: { sourceType: "availability_request" } }, ...(canManageMembers(actor.membership) ? {} : { subjectUserId: actor.user.id }) }, include: { items: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.flatMap(r => { const p = timeOffSchema.safeParse(JSON.parse(r.items[0]?.descriptionMd || "{}")); return p.success ? [{ id: r.id, userId: r.subjectUserId, status: r.status, ...p.data }] : []; });
}
export async function decideTimeOff(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  if (!canManageMembers(actor.membership)) return actionError(NOT_ALLOWED);
  const p = z.object({ id: idSchema, approved: z.boolean() }).safeParse(input); if (!p.success) return validationError(p.error);
  const outcome = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ChecklistRun" WHERE "id"=${p.data.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const run = await tx.checklistRun.findFirst({ where: { id: p.data.id, workspaceId: actor.workspace.id, status: "OPEN", items: { some: { sourceType: "availability_request" } } }, include: { items: true } });
    if (!run?.subjectUserId) return { result: actionError("That request is no longer pending."), notify: null };
    const request = timeOffSchema.safeParse(JSON.parse(run.items[0]?.descriptionMd || "{}")); if (!request.success) return { result: actionError("That request is invalid. Ask the member to try again."), notify: null };
    const userId = run.subjectUserId;
    if (!await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE" }, select: { id: true } })) return { result: actionError(NOT_ALLOWED), notify: null };
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${actor.workspace.id}:${userId}`}))`;
    const range = dayRange(request.data.from, request.data.to, actor.workspace.timezone);
    if (p.data.approved && await tx.availability.findFirst({ where: { workspaceId: actor.workspace.id, userId, startsAt: { lt: range.endsAt }, endsAt: { gt: range.startsAt } }, select: { id: true } })) return { result: actionError("This overlaps approved time off. Adjust the request first."), notify: null };
    const row = p.data.approved ? await tx.availability.create({ data: { workspaceId: actor.workspace.id, userId, ...range, type: request.data.type, note: request.data.note || null, visibility: request.data.visibility } }) : null;
    await tx.checklistRun.update({ where: { id: run.id, workspaceId: actor.workspace.id }, data: { status: p.data.approved ? "DONE" : "CANCELLED", completedAt: new Date() } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: p.data.approved ? "people.time_off_approved" : "people.time_off_declined", targetType: "ChecklistRun", targetId: run.id });
    const notify = await dispatch(actor.workspace.id, { type: "availability.changed", title: `Your time off was ${p.data.approved ? "approved" : "declined"}`, actorId: actor.user.id, recipients: [userId], useWorkspaceRules: false, resource: { type: "availability_request", id: run.id }, url: `/w/${actor.workspace.slug}/members/availability`, data: { availabilityId: row?.id ?? run.id, userId } }, { tx });
    return { result: { ok: true } as ActionResult, notify };
  });
  await outcome.notify?.afterCommit(); return outcome.result;
}
