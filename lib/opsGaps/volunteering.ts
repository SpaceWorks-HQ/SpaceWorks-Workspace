import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { index,admin, adminIds, audit, guard, OperationsError, parse, unavailable, write, type OpsActor } from "./context";
import { dayRange } from "@/lib/people/availability";
import { allocatedMinutes, id, requestKey, title, workedMinutes } from "./rules";
export const hoursSchema = z.object({ activity: title, startsAt: z.coerce.date(), endsAt: z.coerce.date(), breakMinutes: z.coerce.number().int().min(0).max(959), requestKey });
export async function listHours(actor: OpsActor, status = "", page = 1) {
  await guard(actor);
  const state = z.enum(["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]).safeParse(status);
  const own = { workspaceId: actor.workspace.id, ...(admin(actor) ? {} : { userId: actor.user.id }) };
  const where = { ...own, ...(state.success ? { status: state.data } : {}) };
  const [rows, total, approved, pending] = await Promise.all([
    prisma.volunteerLog.findMany({ where, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 25, skip: (page - 1) * 25 }), prisma.volunteerLog.count({ where }),
    prisma.volunteerLog.aggregate({ where: { ...own, status: "APPROVED" }, _sum: { minutes: true } }),
    prisma.volunteerLog.aggregate({ where: { ...own, status: "PENDING" }, _sum: { minutes: true } }),
  ]);
  return { rows, total, approved: approved._sum.minutes ?? 0, pending: pending._sum.minutes ?? 0 };
}
export async function getHours(actor: OpsActor, logId: string) {
  await guard(actor);
  return prisma.volunteerLog.findFirst({ where: { workspaceId: actor.workspace.id, id: logId, ...(admin(actor) ? {} : { userId: actor.user.id }) } });
}
export async function submitHours(actor: OpsActor, input: unknown) {
  const v = parse(hoursSchema, input);
  const minutes = workedMinutes(v.startsAt, v.endsAt, v.breakMinutes);
  if (minutes === null) throw new OperationsError("Enter a shift of up to 16 hours, with a shorter break.");
  if (v.endsAt > new Date()) throw new OperationsError("Log hours after the work has finished.");
  // Every submit/withdraw/review for a person uses the same lock to prevent overlap races.
  return write(actor, `hours:${actor.user.id}`, false, async (tx, emit) => {
    const previous = await tx.volunteerLog.findFirst({ where: { workspaceId: actor.workspace.id, userId: actor.user.id, requestKey: v.requestKey } });
    if (previous) return previous;
    if (await tx.volunteerLog.findFirst({ where: { workspaceId: actor.workspace.id, userId: actor.user.id, status: { in: ["PENDING", "APPROVED"] }, startsAt: { lt: v.endsAt }, endsAt: { gt: v.startsAt } }, select: { id: true } })) throw new OperationsError("These hours overlap an existing log. Check your times.");
    const log = await tx.volunteerLog.create({ data: { ...v, minutes, workspaceId: actor.workspace.id, userId: actor.user.id } });
    await index(actor,"ops_hours",log.id,`Hours: ${log.activity}`,"volunteering",tx,actor.user.id);
    await audit(actor, "hours", log.id, "submitted", tx);
    await emit("ops.hours_submitted", log.id, "Volunteer hours are ready for review", "volunteering", await adminIds(actor.workspace.id, tx));
    return log;
  });
}
export async function reviewHours(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, decision: z.enum(["APPROVED", "REJECTED"]), reviewNote: z.string().trim().min(1, "Add a review note.").max(2000) }), input);
  await guard(actor, true);
  const row = await prisma.volunteerLog.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id }, select: { userId: true } });
  if (!row) throw unavailable();
  return write(actor, `hours:${row.userId}`, true, async (tx, emit) => {
    const log = await tx.volunteerLog.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id } });
    if (!log) throw unavailable();
    if (log.userId === actor.user.id) throw new OperationsError("Another admin must review your hours.");
    if (log.status !== "PENDING") throw new OperationsError("These hours have already been reviewed or withdrawn. Refresh the page.");
    await tx.volunteerLog.updateMany({ where: { workspaceId: actor.workspace.id, id: v.id, status: "PENDING" }, data: { status: v.decision, reviewNote: v.reviewNote, reviewedAt: new Date(), reviewedById: actor.user.id } });
    await audit(actor, "hours", v.id, v.decision.toLowerCase(), tx);
    await emit("ops.hours_reviewed", v.id, "Your volunteer hours have been reviewed", "volunteering", [log.userId]);
  });
}
export async function withdrawHours(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id }), input);
  return write(actor, `hours:${actor.user.id}`, false, async tx => {
    const result = await tx.volunteerLog.updateMany({ where: { workspaceId: actor.workspace.id, id: v.id, userId: actor.user.id, status: "PENDING" }, data: { status: "WITHDRAWN" } });
    if (!result.count) throw new OperationsError("Only your pending hours can be withdrawn. Refresh the page.");
    await audit(actor, "hours", v.id, "withdrawn", tx);
  });
}

export async function monthlyHours(actor: OpsActor, month: string) {
  await guard(actor);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new OperationsError("Choose a valid month.");
  const last = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  const range = dayRange(`${month}-01`,last,actor.workspace.timezone);
  const rows = await prisma.volunteerLog.findMany({ where: { workspaceId:actor.workspace.id,...(admin(actor)?{}:{userId:actor.user.id}), status:{in:["PENDING","APPROVED"]},startsAt:{lt:range.endsAt},endsAt:{gt:range.startsAt} },select:{userId:true,status:true,startsAt:true,endsAt:true,breakMinutes:true,minutes:true} });
  const totals = new Map<string,{userId:string;approved:number;pending:number}>();
  for (const r of rows) {
    // Allocate a cross-month log proportionally; breaks are distributed across elapsed time.
    const minutes = allocatedMinutes(r.minutes,r.startsAt,r.endsAt,range.startsAt,range.endsAt);
    const row = totals.get(r.userId)??{userId:r.userId,approved:0,pending:0};
    if(r.status==="APPROVED")row.approved+=minutes;else row.pending+=minutes;totals.set(r.userId,row);
  }
  return [...totals.values()];
}
