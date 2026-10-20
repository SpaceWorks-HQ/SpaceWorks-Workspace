import "server-only";
import { checkLeave } from "@/lib/opsGaps/leave";
import { guard,indexSingle } from "@/lib/opsGaps/context";
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
export const timeOffSchema = z.object({ requestKey: z.string().uuid().optional(), leaveTypeId: z.string().max(100).optional(), from: z.string().refine(v => Boolean(parseDayKey(v)), "Pick a start day."), to: z.string().refine(v => Boolean(parseDayKey(v)), "Pick an end day."), type: z.enum(["AWAY", "LIMITED", "TRAVEL", "BUSY"]).default("AWAY"), note: z.string().trim().max(200).default(""), visibility: z.enum(["WORKSPACE", "TEAM", "PRIVATE"]).default("WORKSPACE") }).refine(v => v.to >= v.from, { path: ["to"], message: "Pick an end day after the start." });
export async function requestTimeOff(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  try { await guard(actor); } catch { return actionError(NOT_ALLOWED); }
  const p = timeOffSchema.safeParse(input); if (!p.success) return validationError(p.error);
  const range = dayRange(p.data.from, p.data.to, actor.workspace.timezone);
  if (range.endsAt.getTime() - range.startsAt.getTime() > 366 * 86400000) return actionError("Keep a request within a year.");
  const error = await prisma.$transaction(async tx => {
    await guard(actor,false,tx);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${actor.workspace.id}:${actor.user.id}`}))`;
    if (p.data.requestKey) {
      const previous = await tx.checklistRun.findMany({ where: { workspaceId: actor.workspace.id, subjectUserId: actor.user.id, items: { some: { sourceType: "availability_request" } } }, select: { items: { where: { sourceType: "availability_request" }, select: { descriptionMd: true } } } });
      if (previous.some(r => { try { return JSON.parse(r.items[0]?.descriptionMd ?? "{}").requestKey === p.data.requestKey; } catch { return false; } })) return;
    }
    const error = await checkLeave(tx,actor,actor.user.id,p.data);
    if (error) return error;
    const run = await tx.checklistRun.create({ data: { workspaceId: actor.workspace.id, kind: "CUSTOM", title: `Time off: ${p.data.from} to ${p.data.to}`, subjectUserId: actor.user.id, createdById: actor.user.id, items: { create: { title: "Approve time off", descriptionMd: JSON.stringify(p.data), sourceType: "availability_request", assigneeId: (await adminIds(actor.workspace.id, tx))[0] ?? null } } } });
    await indexSingle(actor,"ops_leave",run.id,run.title,`leave?year=${p.data.from.slice(0,4)}`,tx);
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.time_off_requested", targetType: "ChecklistRun", targetId: run.id });
  });
  return error ? actionError(error) : { ok: true };
}
function requestWhere(actor: PeopleActor, status = "", year = "") {
  return { workspaceId: actor.workspace.id, items: { some: { sourceType: "availability_request" } }, ...(canManageMembers(actor.membership) ? {} : { subjectUserId: actor.user.id }), ...(["OPEN","DONE","CANCELLED"].includes(status) ? { status: status as "OPEN" | "DONE" | "CANCELLED" } : {}), ...(/^\d{4}$/.test(year) ? { title: { contains: `${year}-` } } : {}) };
}
export async function countTimeOffRequests(actor: PeopleActor, status = "", year = "") {
  await guard(actor); return prisma.checklistRun.count({ where: requestWhere(actor,status,year) });
}
export async function timeOffRequests(actor: PeopleActor, options?: { page: number; status?: string; year?: string }) {
  if (actor.membership.role === "GUEST") return [];
  await guard(actor);
  const rows = await prisma.checklistRun.findMany({ where: requestWhere(actor,options?.status,options?.year), include: { items: true }, orderBy: [{ createdAt: "desc" },{ id: "desc" }], take: options ? 25 : 100, ...(options ? { skip: (options.page-1)*25 } : {}) });
  return rows.flatMap(r => { try { const p = timeOffSchema.safeParse(JSON.parse(r.items.find(i=>i.sourceType === "availability_request")?.descriptionMd || "{}")); return p.success ? [{ id: r.id, userId: r.subjectUserId, status: r.status, ...p.data }] : []; } catch { return []; } });
}
export async function decideTimeOff(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  if (!canManageMembers(actor.membership)) return actionError(NOT_ALLOWED);
  try { await guard(actor,true); } catch { return actionError(NOT_ALLOWED); }
  const p = z.object({ id: idSchema, approved: z.boolean() }).safeParse(input); if (!p.success) return validationError(p.error);
  const outcome = await prisma.$transaction(async tx => {
    await guard(actor,true,tx);
    await tx.$queryRaw`SELECT "id" FROM "ChecklistRun" WHERE "id"=${p.data.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const run = await tx.checklistRun.findFirst({ where: { id: p.data.id, workspaceId: actor.workspace.id, status: "OPEN", items: { some: { sourceType: "availability_request" } } }, include: { items: true } });
    if (!run?.subjectUserId) return { result: actionError("That request is no longer pending."), notify: null };
    const request = timeOffSchema.safeParse(JSON.parse(run.items[0]?.descriptionMd || "{}")); if (!request.success) return { result: actionError("That request is invalid. Ask the member to try again."), notify: null };
    const userId = run.subjectUserId;
    if (userId === actor.user.id) return { result: actionError("Another admin must review your leave."), notify: null };
    if (!await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE" }, select: { id: true } })) return { result: actionError(NOT_ALLOWED), notify: null };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${actor.workspace.id}:${userId}`}))`;
    const error = p.data.approved ? await checkLeave(tx,actor,userId,request.data,run.id) : null;
    if (error) return { result: actionError(error), notify: null };
    const range = dayRange(request.data.from, request.data.to, actor.workspace.timezone);
    if (p.data.approved && await tx.availability.findFirst({ where: { workspaceId: actor.workspace.id, userId, startsAt: { lt: range.endsAt }, endsAt: { gt: range.startsAt } }, select: { id: true } })) return { result: actionError("This overlaps approved time off. Adjust the request first."), notify: null };
    const row = p.data.approved ? await tx.availability.create({ data: { workspaceId: actor.workspace.id, userId, ...range, type: request.data.type, note: request.data.note || null, visibility: request.data.visibility } }) : null;
    if (row) await tx.checklistRunItem.updateMany({ where: { runId: run.id, sourceType: "availability_request", run: { workspaceId: actor.workspace.id } }, data: { descriptionMd: JSON.stringify({ ...request.data, availabilityId: row.id }) } });
    await tx.checklistRun.update({ where: { id: run.id, workspaceId: actor.workspace.id }, data: { status: p.data.approved ? "DONE" : "CANCELLED", completedAt: new Date() } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: p.data.approved ? "people.time_off_approved" : "people.time_off_declined", targetType: "ChecklistRun", targetId: run.id });
    const notify = await dispatch(actor.workspace.id, { type: "availability.changed", title: `Your time off was ${p.data.approved ? "approved" : "declined"}`, actorId: actor.user.id, recipients: [userId], useWorkspaceRules: false, resource: { type: "availability_request", id: run.id }, url: `/w/${actor.workspace.slug}/members/availability`, data: { availabilityId: row?.id ?? run.id, userId } }, { tx });
    return { result: { ok: true } as ActionResult, notify };
  });
  await outcome.notify?.afterCommit(); return outcome.result;
}
