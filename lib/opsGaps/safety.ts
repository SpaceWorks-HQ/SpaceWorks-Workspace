import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { index,admin, adminIds, adminRef, audit, guard, OperationsError, parse, unavailable, write, type OpsActor } from "./context";
import { body, id, optionalText, requestKey, title } from "./rules";
export const safetySchema = z.object({ title, description: body, immediateAction: optionalText, location: title, kind: z.enum(["INJURY", "NEAR_MISS", "DAMAGE", "HAZARD"]), occurredAt: z.coerce.date(), requestKey });
const statusSchema = z.enum(["REPORTED", "INVESTIGATING", "FOLLOW_UP", "CLOSED"]);
const where = (actor: OpsActor) => ({ workspaceId: actor.workspace.id, ...(admin(actor) ? {} : { reporterId: actor.user.id }) });
export async function listSafety(actor: OpsActor, status = "", page = 1) {
  await guard(actor);
  const filter = { ...where(actor), ...(statusSchema.safeParse(status).success ? { status: statusSchema.parse(status) } : {}) };
  const [rows, total] = await Promise.all([prisma.safetyReport.findMany({ where: filter, select: { id: true, title: true, status: true, kind: true, occurredAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: (page - 1) * 25 }), prisma.safetyReport.count({ where: filter })]);
  return { rows, total };
}
export async function getSafety(actor: OpsActor, reportId: string) {
  await guard(actor);
  const report = await prisma.safetyReport.findFirst({ where: { ...where(actor), id: reportId } });
  if (!report) return null;
  // Follow-up notes are restricted to the handling team, including on the server payload.
  const actions = admin(actor) ? await prisma.safetyFollowUp.findMany({ where: { workspaceId: actor.workspace.id, reportId }, orderBy: { dueAt: "asc" } }) : [];
  return { ...report, actions };
}
export async function createSafety(actor: OpsActor, input: unknown) {
  const v = parse(safetySchema, input);
  if (v.occurredAt > new Date()) throw new OperationsError("Choose an incident time that has already happened.");
  return write(actor, `safety-new:${actor.user.id}:${v.requestKey}`, false, async (tx, emit) => {
    const previous = await tx.safetyReport.findFirst({ where: { workspaceId: actor.workspace.id, reporterId: actor.user.id, requestKey: v.requestKey } });
    if (previous) return previous;
    const report = await tx.safetyReport.create({ data: { ...v, workspaceId: actor.workspace.id, reporterId: actor.user.id } });
    await index(actor,"ops_safety",report.id,report.title,"safety",tx,actor.user.id);
    await audit(actor, "safety", report.id, "reported", tx);
    await emit("ops.safety_changed", report.id, "A confidential safety report needs review", "safety", await adminIds(actor.workspace.id, tx));
    return report;
  });
}
export async function updateSafety(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, status: statusSchema, expectedStatus: statusSchema, closureNote: optionalText }), input);
  return write(actor, `safety:${v.id}`, true, async (tx, emit) => {
    const report = await tx.safetyReport.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id } });
    if (!report) throw unavailable();
    if (report.status !== v.expectedStatus) throw new OperationsError("This report changed. Refresh before saving.");
    if (v.status === "CLOSED") {
      if (!v.closureNote) throw new OperationsError("Add a closure note before closing the report.");
      if (await tx.safetyFollowUp.count({ where: { workspaceId: actor.workspace.id, reportId: v.id, completedAt: null } })) throw new OperationsError("Complete every follow-up before closing this report.");
    }
    const result = await tx.safetyReport.update({ where: { workspaceId_id: { workspaceId: actor.workspace.id, id: v.id } }, data: { status: v.status, closureNote: v.status === "CLOSED" ? v.closureNote : null, closedAt: v.status === "CLOSED" ? new Date() : null } });
    await audit(actor, "safety", v.id, "status_changed", tx);
    await emit("ops.safety_changed", v.id, "Your confidential safety report has an update", "safety", [report.reporterId]);
    return result;
  });
}
export async function addSafetyAction(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, title, assigneeId: id, dueAt: z.coerce.date() }), input);
  return write(actor, `safety:${v.id}`, true, async (tx, emit) => {
    const report = await tx.safetyReport.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id } });
    if (!report) throw unavailable();
    if (report.status === "CLOSED") throw new OperationsError("Reopen the report before adding a follow-up.");
    await adminRef(actor, v.assigneeId, tx);
    const result = await tx.safetyFollowUp.create({ data: { workspaceId: actor.workspace.id, reportId: v.id, title: v.title, assigneeId: v.assigneeId, dueAt: v.dueAt } });
    await audit(actor, "safety", v.id, "follow_up_added", tx);
    await emit("ops.safety_changed", v.id, "A confidential safety follow-up is assigned to you", "safety", [v.assigneeId]);
    return result;
  });
}
export async function completeSafetyAction(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id, actionId: id, completionNote: body }), input);
  return write(actor, `safety:${v.id}`, true, async tx => {
    const report = await tx.safetyReport.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id, status: { not: "CLOSED" } } });
    if (!report) throw unavailable();
    const result = await tx.safetyFollowUp.updateMany({ where: { workspaceId: actor.workspace.id, reportId: v.id, id: v.actionId, completedAt: null }, data: { completedAt: new Date(), completedById: actor.user.id, completionNote: v.completionNote } });
    if (!result.count) throw unavailable();
    await audit(actor, "safety", v.id, "follow_up_completed", tx);
  });
}
