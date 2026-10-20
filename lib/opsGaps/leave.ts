import "server-only";
import { z } from "zod";
import { prisma, type DbClient } from "@/lib/db";
import { dayRange } from "@/lib/people/availability";
import { adminIds,admin, guard, parse, audit, write, OperationsError, type OpsActor } from "./context";
import { day, id, title, leaveDays, ENGAGEMENT_TYPES } from "./rules";

export async function leaveUsage(client: DbClient, workspaceId: string, userId: string, typeId: string, year: number, excludeId?: string) {
  const rows = await client.checklistRun.findMany({ where: { workspaceId, subjectUserId: userId, status: { in: ["OPEN", "DONE"] }, ...(excludeId ? { id: { not: excludeId } } : {}), items: { some: { sourceType: "availability_request" } } }, select: { status: true, items: { where: { sourceType: "availability_request" }, select: { descriptionMd: true } } } });
  let used = 0, pending = 0;
  for (const row of rows) {
    try { const v = JSON.parse(row.items[0]?.descriptionMd ?? "{}"); if (v.leaveTypeId === typeId && Number(String(v.from).slice(0,4)) === year) { const days = leaveDays(v.from,v.to); if (Number.isFinite(days)) { if (row.status === "DONE") used += days; else pending += days; } } } catch { /* Invalid legacy requests do not consume leave. */ }
  }
  return { used, pending };
}
export async function checkLeave(client: DbClient, actor: OpsActor, userId: string, data: { from: string; to: string; leaveTypeId?: string }, excludeId?: string) {
  if (!data.leaveTypeId) return null;
  if (data.from.slice(0,4) !== data.to.slice(0,4)) return "Split leave across calendar years into separate requests.";
  const type = await client.leaveType.findFirst({ where: { workspaceId: actor.workspace.id, id: data.leaveTypeId, active: true } });
  if (!type) return "Choose an active leave type in this workspace.";
  const year = Number(data.from.slice(0,4));
  const balance = await client.leaveBalance.findFirst({ where: { workspaceId: actor.workspace.id, userId, typeId: type.id, year } });
  if (!balance) return "Ask an admin to set your yearly balance for this leave type.";
  const usage = await leaveUsage(client, actor.workspace.id, userId, type.id, year, excludeId);
  if (usage.used + leaveDays(data.from,data.to) > balance.allowanceDays) return "This request exceeds your remaining yearly balance.";
  return null;
}
export async function leaveData(actor: OpsActor, year: number) {
  await guard(actor);
  const [types, balances, profiles] = await Promise.all([
    prisma.leaveType.findMany({ where: { workspaceId: actor.workspace.id }, orderBy: { name: "asc" } }),
    prisma.leaveBalance.findMany({ where: { workspaceId: actor.workspace.id, year, ...(admin(actor) ? {} : { userId: actor.user.id }) }, include: { type: true }, orderBy: { userId: "asc" } }),
    prisma.memberProfile.findMany({ where: { workspaceId: actor.workspace.id, ...(admin(actor) ? {} : { userId: actor.user.id }) }, select: { userId: true, engagementType: true, engagementStart: true, engagementEnd: true } }),
  ]);
  return { types, profiles, balances: await Promise.all(balances.map(async b => ({ ...b, ...await leaveUsage(prisma,actor.workspace.id,b.userId,b.typeId,year) }))) };
}
export async function saveLeaveType(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ name: title }), input);
  return write(actor,"leave-types",true,async tx => { const row = await tx.leaveType.upsert({ where: { workspaceId_name: { workspaceId: actor.workspace.id, name: v.name } }, update: { active: true }, create: { workspaceId: actor.workspace.id, name: v.name } }); await audit(actor,"leave_type",row.id,"saved",tx); });
}
export async function saveBalance(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ userId: id, typeId: id, year: z.coerce.number().int().min(2000).max(2200), allowanceDays: z.coerce.number().int().min(0).max(366) }),input);
  return write(actor,`availability:${v.userId}`,true,async tx => {
    // Share the availability lock with approvals and cancellations.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${actor.workspace.id}:${v.userId}`}))`;
    if (!await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: v.userId, status: "ACTIVE", role: { not: "GUEST" } } }) || !await tx.leaveType.findFirst({ where: { workspaceId: actor.workspace.id, id: v.typeId } })) throw new OperationsError("Choose a person and leave type in this workspace.");
    if ((await leaveUsage(tx,actor.workspace.id,v.userId,v.typeId,v.year)).used > v.allowanceDays) throw new OperationsError("The allowance cannot be less than leave already approved.");
    const r = await tx.leaveBalance.upsert({ where: { workspaceId_userId_year_typeId: { workspaceId: actor.workspace.id, userId: v.userId, year: v.year, typeId: v.typeId } }, create: { ...v, workspaceId: actor.workspace.id }, update: { allowanceDays: v.allowanceDays } }); await audit(actor,"leave_balance",r.id,"saved",tx);
  });
}
export async function saveEngagement(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ userId: id, engagementType: z.enum(ENGAGEMENT_TYPES), startsOn: day.or(z.literal("")), endsOn: day.or(z.literal("")) }),input);
  if (v.startsOn && v.endsOn && v.endsOn < v.startsOn) throw new OperationsError("Choose an end date after the start date.");
  return write(actor,`profile:${v.userId}`,true,async tx => {
    const target = await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: v.userId, status: "ACTIVE" } });
    if (!target || (actor.membership.role === "ADMIN" && ["OWNER","ADMIN"].includes(target.role))) throw new OperationsError("You cannot change this member’s engagement details.");
    const data = { engagementType: v.engagementType, engagementStart: v.startsOn ? new Date(v.startsOn) : null, engagementEnd: v.endsOn ? new Date(v.endsOn) : null };
    await tx.memberProfile.upsert({ where: { workspaceId_userId: { workspaceId: actor.workspace.id, userId: v.userId } }, update: data, create: { workspaceId: actor.workspace.id, userId: v.userId, ...data } }); await audit(actor,"profile",v.userId,"engagement_saved",tx);
  });
}
export async function cancelLeave(actor: OpsActor, input: unknown) {
  const v = parse(z.object({ id }),input);
  return write(actor,`leave:${v.id}`,false,async (tx,emit) => {
    await tx.$queryRaw`SELECT "id" FROM "ChecklistRun" WHERE "id"=${v.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const run = await tx.checklistRun.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id, subjectUserId: actor.user.id, status: { in: ["OPEN","DONE"] }, items: { some: { sourceType: "availability_request" } } }, include: { items: true } });
    if (!run) throw new OperationsError("Only your pending or approved leave can be cancelled.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${actor.workspace.id}:${actor.user.id}`}))`;
    const data = JSON.parse(run.items.find(i=>i.sourceType === "availability_request")?.descriptionMd ?? "{}");
    const range = dayRange(data.from,data.to,actor.workspace.timezone);
    if (run.status === "DONE") await tx.availability.deleteMany({ where: { workspaceId: actor.workspace.id, userId: actor.user.id, ...(data.availabilityId ? { id: String(data.availabilityId) } : range) } });
    await tx.checklistRun.update({ where: { id: v.id, workspaceId: actor.workspace.id }, data: { status: "CANCELLED", completedAt: new Date() } });
    await audit(actor,"leave",v.id,"cancelled",tx);
    await emit("ops.people_changed",v.id,"A leave request was cancelled","leave",await adminIds(actor.workspace.id,tx));
  });
}
